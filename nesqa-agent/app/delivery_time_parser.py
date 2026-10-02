from __future__ import annotations

from datetime import datetime, timedelta
import os
import re
from typing import Optional
from zoneinfo import ZoneInfo

from openai import OpenAI
from pydantic import BaseModel, Field


DUBAI_TIMEZONE = ZoneInfo("Asia/Dubai")


class DeliveryTimeSelection(BaseModel):
    understood: bool = Field(description="Whether the requested delivery time is clear.")
    delivery_at: str = Field(
        description="Future ISO 8601 delivery datetime with the +04:00 Abu Dhabi offset, or an empty string."
    )
    clarification: str = Field(
        description="A short clarification question when the time is unclear, otherwise an empty string."
    )


def _display_time(value: datetime) -> str:
    hour = value.strftime("%I").lstrip("0") or "0"
    return f"{value.strftime('%a, %d %b')} at {hour}:{value.strftime('%M %p')}"


def _validated(value: datetime, now: datetime) -> Optional[DeliveryTimeSelection]:
    local_value = value.astimezone(DUBAI_TIMEZONE)
    if local_value <= now:
        return None
    return DeliveryTimeSelection(
        understood=True,
        delivery_at=local_value.isoformat(),
        clarification="",
    )


def _local_parse(message: str, now: datetime) -> Optional[DeliveryTimeSelection]:
    text = message.casefold().strip()
    day_offset = 1 if "tomorrow" in text else 0

    period_hour = None
    if "tonight" in text:
        period_hour = 20
    elif "morning" in text:
        period_hour = 9
    elif "afternoon" in text:
        period_hour = 14
    elif "evening" in text:
        period_hour = 18

    twelve_hour = re.search(r"\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b", text)
    twenty_four_hour = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)

    if twelve_hour:
        hour = int(twelve_hour.group(1)) % 12
        minute = int(twelve_hour.group(2) or 0)
        if twelve_hour.group(3).replace(".", "").startswith("p"):
            hour += 12
    elif twenty_four_hour:
        hour = int(twenty_four_hour.group(1))
        minute = int(twenty_four_hour.group(2))
    elif period_hour is not None:
        hour = period_hour
        minute = 0
    else:
        return None

    target_date = (now + timedelta(days=day_offset)).date()
    candidate = datetime(
        target_date.year,
        target_date.month,
        target_date.day,
        hour,
        minute,
        tzinfo=DUBAI_TIMEZONE,
    )
    if "today" in text and candidate <= now:
        return DeliveryTimeSelection(
            understood=False,
            delivery_at="",
            clarification="That time has already passed in Abu Dhabi. What future delivery time should I use?",
        )
    if day_offset == 0 and candidate <= now:
        candidate += timedelta(days=1)
    return _validated(candidate, now)


def parse_delivery_time(message: str, now: Optional[datetime] = None) -> DeliveryTimeSelection:
    """Resolve a natural delivery time and enforce a future Asia/Dubai datetime."""
    current = (now or datetime.now(DUBAI_TIMEZONE)).astimezone(DUBAI_TIMEZONE)
    local = _local_parse(message, current)
    if local is not None:
        return local

    if os.getenv("OPENAI_API_KEY"):
        try:
            response = OpenAI(timeout=10.0, max_retries=0).responses.parse(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Extract the grocery delivery time requested by the shopper. "
                            "The current Abu Dhabi datetime is "
                            f"{current.isoformat()}. Return a future ISO 8601 datetime with +04:00. "
                            "Interpret tonight as 8 PM, morning as 9 AM, afternoon as 2 PM, "
                            "and evening as 6 PM. A time without a date means its next future "
                            "occurrence. If no clear delivery time is given, set understood false, "
                            "delivery_at to an empty string, and ask a short clarification question."
                        ),
                    },
                    {"role": "user", "content": message},
                ],
                text_format=DeliveryTimeSelection,
                store=False,
            )
            parsed: Optional[DeliveryTimeSelection] = response.output_parsed
            if parsed and parsed.understood and parsed.delivery_at:
                value = datetime.fromisoformat(parsed.delivery_at)
                if value.tzinfo is not None:
                    valid = _validated(value, current)
                    if valid is not None:
                        return valid
            if parsed and parsed.clarification:
                return DeliveryTimeSelection(
                    understood=False,
                    delivery_at="",
                    clarification=parsed.clarification,
                )
        except Exception:
            pass

    return DeliveryTimeSelection(
        understood=False,
        delivery_at="",
        clarification="What time should I schedule delivery? For example, 6 PM, tonight, or tomorrow morning.",
    )


def delivery_time_payload(selection: DeliveryTimeSelection) -> dict:
    value = datetime.fromisoformat(selection.delivery_at).astimezone(DUBAI_TIMEZONE)
    return {
        "delivery_at": value.isoformat(),
        "display_text": _display_time(value),
        "timezone": "Asia/Dubai",
    }

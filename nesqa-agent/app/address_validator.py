from __future__ import annotations

import os
import re
from typing import List, Optional

from openai import OpenAI
from pydantic import BaseModel, Field


class AddressCheck(BaseModel):
    has_property_number: bool = Field(
        description="Whether a flat, apartment, villa, unit, or building number is present."
    )
    has_street_or_area: bool = Field(
        description="Whether a street, road, neighborhood, island, or named area is present."
    )
    city_is_abu_dhabi: bool = Field(
        description="Whether the stated city is Abu Dhabi."
    )
    missing_fields: List[str]


def _local_address_check(address: str) -> AddressCheck:
    lowered = address.casefold()
    has_property = bool(
        re.search(
            r"\b(?:apartment|apt|flat|villa|unit|building|tower)\s*(?:no\.?|number|#)?\s*[a-z0-9-]+",
            lowered,
        )
    )
    has_area = bool(
        re.search(
            r"\b(?:street|st\.?|road|rd\.?|area|district|community|island|corniche|"
            r"reem|maryah|yas|saadiyat|khalifa|musaffah|mbz)\b",
            lowered,
        )
    )
    is_abu_dhabi = bool(re.search(r"\babu\s*dhabi\b", lowered))
    missing = []
    if not has_property:
        missing.append("flat, apartment, villa, unit, or building number")
    if not has_area:
        missing.append("street or area")
    if not is_abu_dhabi:
        missing.append("Abu Dhabi city")
    return AddressCheck(
        has_property_number=has_property,
        has_street_or_area=has_area,
        city_is_abu_dhabi=is_abu_dhabi,
        missing_fields=missing,
    )


def validate_address(address: str) -> AddressCheck:
    """Check address completeness; this does not verify that a property exists."""
    local = _local_address_check(address)
    if not os.getenv("OPENAI_API_KEY"):
        return local

    try:
        response = OpenAI(timeout=10.0, max_retries=0).responses.parse(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            input=[
                {
                    "role": "system",
                    "content": (
                        "Check whether a UAE grocery delivery address contains a flat, apartment, "
                        "villa, unit, or building number; a street or named area; and explicitly "
                        "identifies Abu Dhabi as the city. Do not claim the property exists. "
                        "Only evaluate whether the spoken address is complete enough for delivery."
                    ),
                },
                {"role": "user", "content": address},
            ],
            text_format=AddressCheck,
            store=False,
        )
        model_check: Optional[AddressCheck] = response.output_parsed
        if model_check is None:
            return local

        # Abu Dhabi is a hard backend rule, independent of the model's opinion.
        model_check.city_is_abu_dhabi = local.city_is_abu_dhabi
        missing = []
        if not model_check.has_property_number:
            missing.append("flat, apartment, villa, unit, or building number")
        if not model_check.has_street_or_area:
            missing.append("street or area")
        if not model_check.city_is_abu_dhabi:
            missing.append("Abu Dhabi city")
        model_check.missing_fields = missing
        return model_check
    except Exception:
        return local

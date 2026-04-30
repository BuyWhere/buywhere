import importlib.util
import sys
from pathlib import Path


MODULE_PATH = Path("/home/paperclip/buywhere-api/scripts/category_mapper.py")


spec = importlib.util.spec_from_file_location("category_mapper", MODULE_PATH)
category_mapper = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = category_mapper
spec.loader.exec_module(category_mapper)


def test_classify_category_maps_major_taxonomy_groups():
    assert category_mapper.classify_category("Mobiles & Tablets").mapped_category == "Electronics"
    assert category_mapper.classify_category("Health & Beauty - Skincare").mapped_category == "Beauty"
    assert category_mapper.classify_category("Health & Beauty - Medical Devices").mapped_category == "Health"
    assert category_mapper.classify_category("Kids & Baby").mapped_category == "Toys"
    assert category_mapper.classify_category("Groceries & Food - Dairy").mapped_category == "Groceries"


def test_extract_category_falls_back_to_filename_when_missing():
    record = {"platform": "challenger_sg"}
    path = Path("/home/paperclip/buywhere-api/data/challenger/phones.jsonl")
    assert category_mapper.extract_category(record, path) == "phones"

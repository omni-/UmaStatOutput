import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
SPEC = importlib.util.spec_from_file_location("sync_cards", ROOT / "scripts" / "sync_cards.py")
sync_cards = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_cards)


class SyncCardsTests(unittest.TestCase):
    def test_fixture_pipeline_parses_and_normalizes_upstream_shapes(self):
        cards = sync_cards.extract_json_array((FIXTURES / "cards.js").read_text(encoding="utf-8"))
        events = sync_cards.extract_events((FIXTURES / "events.js").read_text(encoding="utf-8"), minimum_rows=2)
        titles, portraits = sync_cards.extract_metadata_from_file((FIXTURES / "metadata.json").read_text(encoding="utf-8"))

        result = sync_cards.normalize(cards, events, titles, portraits, minimum_rows=2)

        self.assertEqual([(row["id"], row["limit_break"]) for row in result], [(1001, 0), (1002, 4)])
        self.assertEqual(result[0]["title"], "Fixture Title")
        self.assertEqual(result[0]["portrait_url"], "https://example.test/1001.png")
        self.assertEqual(result[0]["event_stats"], [1, 2, 3, 4, 5, 6, 7, 8])
        self.assertEqual(result[1]["specialty_rate"], 0)
        self.assertEqual(result[1]["offstat_appearance_denominator"], 4)
        self.assertFalse(result[0]["is_future"])

    def test_js_object_literal_card_modules_are_supported(self):
        source = '''const cards = [
          {
            id: 30001,
            type: 0,
            rarity: 3,
            limit_break: 4,
            char_name: "Future Uma",
            stat_bonus: [1,0,0,0,0,0],
          },
        ];
        export default cards;'''
        cards = sync_cards.extract_json_array(source)
        self.assertEqual(cards[0]["id"], 30001)
        self.assertEqual(cards[0]["char_name"], "Future Uma")

    def test_future_cards_are_jp_ids_missing_from_global(self):
        global_cards = [{"id": 1001, "type": 0}, {"id": 1002, "type": 4}]
        jp_cards = [{"id": 1002, "type": 4}, {"id": 2001, "type": 1}, {"id": 9999, "type": 6}]
        global_ids = {int(card["id"]) for card in global_cards if sync_cards.valid_training_card(card)}
        future = [card for card in jp_cards if sync_cards.valid_training_card(card) and int(card["id"]) not in global_ids]
        self.assertEqual([card["id"] for card in future], [2001])

    def test_suspiciously_small_inputs_still_fail_by_default(self):
        event_source = (FIXTURES / "events.js").read_text(encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "suspiciously small event dataset"):
            sync_cards.extract_events(event_source)

    def test_card_array_requires_valid_json_or_supported_js_literal(self):
        with self.assertRaises((ValueError, TypeError)):
            sync_cards.extract_json_array("export default [not valid];")


if __name__ == "__main__":
    unittest.main()

import importlib.util
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FIXTURES=Path(__file__).parent/"fixtures"
SPEC=importlib.util.spec_from_file_location("sync_cards",ROOT/"scripts"/"sync_cards.py")
sync_cards=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(sync_cards)
class SyncCardsTests(unittest.TestCase):
    def test_fixture_pipeline_parses_and_normalizes_upstream_shapes(self):
        cards=sync_cards.extract_json_array((FIXTURES/"cards.js").read_text(encoding="utf-8"));events=sync_cards.extract_events((FIXTURES/"events.js").read_text(encoding="utf-8"),minimum_rows=2);titles,portraits=sync_cards.extract_metadata_from_file((FIXTURES/"metadata.json").read_text(encoding="utf-8"));result=sync_cards.normalize(cards,events,titles,portraits,minimum_rows=2)
        self.assertEqual([(r["id"],r["limit_break"]) for r in result],[(1001,0),(1002,4)]);self.assertEqual(result[0]["title"],"Fixture Title");self.assertEqual(result[0]["portrait_url"],"https://example.test/1001.png");self.assertEqual(result[0]["event_stats"],[1,2,3,4,5,6,7,8]);self.assertFalse(result[0]["future"])
    def test_future_merge_keeps_only_jp_only_ids(self):
        global_cards=[{"id":1001,"type":0,"limit_break":0},{"id":1002,"type":4,"limit_break":0}];jp_cards=[{"id":1001,"type":0,"limit_break":0},{"id":2001,"type":2,"limit_break":0},{"id":2001,"type":2,"limit_break":4}]
        tagged=sync_cards.merge_global_and_future(global_cards,jp_cards)
        self.assertEqual([(r["id"],future) for r,future in tagged],[(1001,False),(1002,False),(2001,True),(2001,True)])
    def test_euophrys_js_object_literal_card_array_is_supported(self):
        source='''const cards = [
          {
            id: 30147,
            type: 0,
            rarity: 3,
            limit_break: 4,
            char_name: "ジャングルポケット",
            specialty_rate: 80,
          },
        ];
        export default cards;'''
        cards=sync_cards.extract_json_array(source)
        self.assertEqual(cards[0]["id"],30147);self.assertEqual(cards[0]["char_name"],"ジャングルポケット")
    def test_umapyoi_support_chara_id_joins_character_game_id(self):
        support_rows=[{"id":30147,"chara_id":1061,"title_en":"[The Frontier]"}]
        character_rows=[{"id":9999,"game_id":1061,"name_en":"Jungle Pocket","name_jp":"ジャングルポケット","thumb_img":"https://example.test/jungle.png"}]
        titles,names,portraits=sync_cards.join_umapyoi_metadata(support_rows,character_rows,{30147})
        self.assertEqual(titles[30147],"The Frontier");self.assertEqual(names[30147],"Jungle Pocket");self.assertEqual(portraits[30147],"https://example.test/jungle.png")
    def test_future_card_uses_umapyoi_english_name_without_overriding_global_names(self):
        required={"type":0,"rarity":3,"limit_break":4,"specialty_rate":80}
        tagged=[({"id":30147,"char_name":"ジャングルポケット",**required},True),({"id":30028,"char_name":"Kitasan Black",**required},False)]
        result=sync_cards.normalize_tagged(tagged,{}, {},{},minimum_rows=2,names={30147:"Jungle Pocket",30028:"Should Not Replace"})
        by_id={row["id"]:row for row in result}
        self.assertEqual(by_id[30147]["char_name"],"Jungle Pocket");self.assertEqual(by_id[30028]["char_name"],"Kitasan Black")
    def test_suspiciously_small_inputs_still_fail_by_default(self):
        with self.assertRaisesRegex(ValueError,"suspiciously small event dataset"):sync_cards.extract_events((FIXTURES/"events.js").read_text(encoding="utf-8"))
    def test_card_array_requires_valid_json(self):
        with self.assertRaises((ValueError,TypeError)):sync_cards.extract_json_array("export default [not valid];")
if __name__=="__main__":unittest.main()

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
FIXTURES=Path(__file__).parent/"fixtures"
SPEC=importlib.util.spec_from_file_location("sync_cards",ROOT/"scripts"/"sync_cards.py")
sync_cards=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(sync_cards)
class SyncCardsTests(unittest.TestCase):
    def test_fixture_pipeline_parses_and_normalizes_upstream_shapes(self):
        cards=sync_cards.extract_json_array((FIXTURES/"cards.js").read_text(encoding="utf-8"));events=sync_cards.extract_events((FIXTURES/"events.js").read_text(encoding="utf-8"),minimum_rows=2);titles,portraits=sync_cards.extract_metadata_from_file((FIXTURES/"metadata.json").read_text(encoding="utf-8"));result=sync_cards.normalize(cards,events,titles,portraits,minimum_rows=2)
        self.assertEqual([(r["id"],r["limit_break"]) for r in result],[(1001,0),(1002,4),(1003,4)]);self.assertEqual(result[0]["title"],"Fixture Title");self.assertEqual(result[0]["portrait_url"],"https://example.test/1001.png");self.assertEqual(result[0]["event_stats"],[1,2,3,4,5,6,7,8]);self.assertEqual(result[0]["starting_stats"],[10,0,5,0,0]);self.assertEqual(result[1]["starting_stats"],[0,0,0,0,0]);self.assertFalse(result[0]["future"]);self.assertIsNone(result[0]["special_uniques"])
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
    def test_umapyoi_character_info_endpoint_supplies_english_name(self):
        support_rows=[{"id":30147,"chara_id":1061,"title_en":"[The Frontier]"}]
        character_rows=[{"id":157,"game_id":1061,"name_en":"Jungle Pocket","thumb_img":"https://example.test/jungle.png"}]
        def fake_fetch(url):
            if url.endswith("/support"):return support_rows
            if url.endswith("/character/info"):return character_rows
            raise AssertionError(f"Unexpected URL: {url}")
        with patch.object(sync_cards,"fetch_json",side_effect=fake_fetch):
            titles,names,portraits=sync_cards.fetch_umapyoi_metadata("https://api.umapyoi.net/api/v1/support",{30147})
        self.assertEqual(titles[30147],"The Frontier");self.assertEqual(names[30147],"Jungle Pocket");self.assertEqual(portraits[30147],"https://example.test/jungle.png")
    def test_future_card_uses_umapyoi_english_name_without_overriding_global_names(self):
        required={"type":0,"rarity":3,"limit_break":4,"specialty_rate":80}
        tagged=[({"id":30147,"char_name":"ジャングルポケット",**required},True),({"id":30028,"char_name":"Kitasan Black",**required},False)]
        result=sync_cards.normalize_tagged(tagged,{}, {},{},minimum_rows=2,names={30147:"Jungle Pocket",30028:"Should Not Replace"})
        by_id={row["id"]:row for row in result}
        self.assertEqual(by_id[30147]["char_name"],"Jungle Pocket");self.assertEqual(by_id[30028]["char_name"],"Kitasan Black")
    def test_bulk_support_data_preserves_raw_unique_type_and_values(self):
        payload={"pageProps":{"supportData":[{"support_id":30097,"unique":{"level":30,"effects":[{"type":101,"value":80,"value_1":7,"value_2":1,"value_3":30,"value_4":1}]}},{"support_id":10001,"unique":None}]}}
        uniques=sync_cards.extract_unique_metadata(payload)
        self.assertEqual(uniques[30097]["level"],30)
        self.assertEqual(uniques[30097]["effects"],[{"type":101,"value":80,"value_1":7,"value_2":1,"value_3":30,"value_4":1}])
        self.assertEqual(uniques[10001],{"level":None,"effects":[]})
    def test_normalized_rows_attach_raw_unique_metadata_by_support_id(self):
        required={"type":0,"rarity":3,"limit_break":4,"specialty_rate":80,"char_name":"Synthetic"}
        result=sync_cards.normalize_tagged([({"id":55555,**required},False)],{}, {},{},minimum_rows=1,uniques={55555:{"level":30,"effects":[{"type":111,"value":8,"value_1":5}]}})
        self.assertEqual(result[0]["special_unique_level"],30)
        self.assertEqual(result[0]["special_uniques"],[{"type":111,"value":8,"value_1":5}])
    def test_missing_unique_metadata_remains_distinguishable_from_no_unique(self):
        required={"type":0,"rarity":3,"limit_break":4,"specialty_rate":80,"char_name":"Synthetic"}
        result=sync_cards.normalize_tagged([({"id":55555,**required},False)],{}, {},{},minimum_rows=1)
        self.assertIsNone(result[0]["special_uniques"])
    def test_suspiciously_small_inputs_still_fail_by_default(self):
        with self.assertRaisesRegex(ValueError,"suspiciously small event dataset"):sync_cards.extract_events((FIXTURES/"events.js").read_text(encoding="utf-8"))
    def test_card_array_requires_valid_json(self):
        with self.assertRaises((ValueError,TypeError)):sync_cards.extract_json_array("export default [not valid];")
    def test_friend_and_group_supports_are_playable_but_other_types_are_not(self):
        cards=sync_cards.extract_json_array((FIXTURES/"cards.js").read_text(encoding="utf-8"))
        ids=[c["id"] for c in sync_cards.playable(cards)]
        self.assertIn(1003,ids);self.assertNotIn(9999,ids)
    def test_group_flag_survives_normalization(self):
        cards=sync_cards.extract_json_array((FIXTURES/"cards.js").read_text(encoding="utf-8"))
        by_id={row["id"]:row for row in sync_cards.normalize(cards,{}, {},{},minimum_rows=2)}
        self.assertEqual(by_id[1003]["type"],6);self.assertTrue(by_id[1003]["group"]);self.assertEqual(by_id[1003]["offstat_appearance_denominator"],5)
        self.assertFalse(by_id[1001]["group"])
    def test_thin_unique_metadata_fails_the_build(self):
        with self.assertRaisesRegex(ValueError,"refusing to publish a degraded dataset"):sync_cards.check_unique_coverage(3,100)
        sync_cards.check_unique_coverage(100,100)
        sync_cards.check_unique_coverage(3,100,allow_degraded=True)
    def test_a_listed_but_empty_unique_does_not_count_as_coverage(self):
        """A payload that lists every support with no effects is the degraded
        case the guard exists for, so it must not read as full coverage."""
        payload={"supportData":[{"support_id":card_id,"unique":None} for card_id in range(1,201)]}
        uniques=sync_cards.extract_unique_metadata(payload)
        required={"type":0,"rarity":3,"limit_break":4,"specialty_rate":80,"char_name":"Synthetic"}
        rows=sync_cards.normalize_tagged([({"id":card_id,**required},False) for card_id in range(1,201)],{}, {},{},minimum_rows=1,uniques=uniques)
        self.assertEqual(len(uniques),200)
        # Present in the payload, but carrying nothing: not coverage.
        self.assertEqual(len({r["id"] for r in rows if r["special_uniques"] is not None}),200)
        self.assertEqual(len({r["id"] for r in rows if r["special_uniques"]}),0)
        with self.assertRaisesRegex(ValueError,"refusing to publish"):sync_cards.check_unique_coverage(len({r["id"] for r in rows if r["special_uniques"]}),100)
    def test_card_art_is_downloaded_once_and_survives_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/"img"
            def fake_fetch(url):
                if "404" in url:raise OSError("not found")
                return b"png-bytes"
            with patch.object(sync_cards,"fetch_bytes",side_effect=fake_fetch):
                report=sync_cards.download_images({1001,404},target)
                self.assertEqual((report["saved"],report["failed"]),(1,1))
                self.assertEqual((target/"support_card_s_1001.png").read_bytes(),b"png-bytes")
                again=sync_cards.download_images({1001},target)
                self.assertEqual((again["saved"],again["skipped"]),(0,1))
    def test_portraits_are_localized_and_missing_ones_keep_their_url(self):
        cards=[{"id":1001,"portrait_url":"https://example.test/a.png"},{"id":1002,"portrait_url":"https://example.test/b.webp"},{"id":1003,"portrait_url":""}]
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/"img"
            def fake_fetch(url):
                if url.endswith("b.webp"):raise OSError("not found")
                return b"image-bytes"
            with patch.object(sync_cards,"fetch_bytes",side_effect=fake_fetch):
                report=sync_cards.download_portraits(cards,target)
            self.assertEqual((report["saved"],report["failed"]),(1,1))
            self.assertEqual(cards[0]["portrait_url"],"./img/portrait_1001.png")
            self.assertEqual(cards[1]["portrait_url"],"https://example.test/b.webp")
            self.assertEqual(cards[2]["portrait_url"],"")
            self.assertTrue((target/"portrait_1001.png").exists())
    def test_cached_portraits_are_still_pointed_at_locally(self):
        """The production path on CI: every file is already in the restored
        cache, so nothing is downloaded and the rows must still be rewritten."""
        cards=[{"id":1001,"portrait_url":"https://example.test/a.png"},{"id":1002,"portrait_url":""}]
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/"img";target.mkdir()
            (target/"portrait_1001.png").write_bytes(b"cached");(target/"portrait_1002.png").write_bytes(b"cached")
            def fail(url):raise AssertionError(f"should not download {url}")
            with patch.object(sync_cards,"fetch_bytes",side_effect=fail):
                report=sync_cards.download_portraits(cards,target)
            self.assertEqual((report["saved"],report["skipped"],report["failed"]),(0,2,0))
            self.assertEqual(cards[0]["portrait_url"],"./img/portrait_1001.png")
            # Metadata degraded for 1002, but the cached file is still usable.
            self.assertEqual(cards[1]["portrait_url"],"./img/portrait_1002.png")
    def test_a_truncated_image_is_not_left_behind(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/"img";target.mkdir()
            def boom(url):raise OSError("connection reset")
            with patch.object(sync_cards,"fetch_bytes",side_effect=boom):
                sync_cards.download_images({1001},target)
            self.assertEqual(list(target.iterdir()),[])
    def test_image_downloads_stop_after_a_run_of_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            attempts=[]
            def boom(url):attempts.append(url);raise OSError("throttled")
            with patch.object(sync_cards,"fetch_bytes",side_effect=boom):
                report=sync_cards.download_images(set(range(1,201)),Path(directory)/"img")
            self.assertEqual(len(attempts),sync_cards.CONSECUTIVE_IMAGE_FAILURE_LIMIT)
            self.assertEqual(report["failed"],200)
    def test_a_transient_fetch_failure_is_retried(self):
        calls=[]
        def flaky():
            calls.append(1)
            if len(calls)<3:raise OSError("timeout")
            return "ok"
        with patch.object(sync_cards.time,"sleep",lambda seconds:None):
            self.assertEqual(sync_cards.fetch_with_retries(flaky),"ok")
        self.assertEqual(len(calls),3)
        def always_fails():raise OSError("down")
        with patch.object(sync_cards.time,"sleep",lambda seconds:None):
            with self.assertRaises(OSError):sync_cards.fetch_with_retries(always_fails)
    def test_portrait_extension_follows_the_source_url(self):
        self.assertEqual(sync_cards.portrait_extension("https://example.test/a.webp?x=1"),".webp")
        self.assertEqual(sync_cards.portrait_extension("https://example.test/a"),".png")
if __name__=="__main__":unittest.main()

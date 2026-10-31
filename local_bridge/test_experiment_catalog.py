import unittest
from experiment_catalog import systems, resolve_system, visible_systems, FLASH_REPRESENTATIVES
from collections import Counter

class CatalogTests(unittest.TestCase):
    def test_defaults_are_distinct_runnable_routes(self):
        for tier, sid in [('flash','flash-v19-sem_select'),('pro','pro-v25'),('max','max-v31')]:
            self.assertEqual(resolve_system(sid,tier)['status'],'runnable')
    def test_mismatched_tier_and_unverified_version_rejected(self):
        with self.assertRaises(ValueError): resolve_system('max-v31','flash')
        with self.assertRaises(ValueError): resolve_system('flash-v17-patch1','flash')

    def test_flash_representatives_cover_every_generation_at_most_twice(self):
        entries=[s for s in visible_systems() if s['family']=='Flash']
        self.assertEqual({s['id'] for s in entries}, FLASH_REPRESENTATIVES)
        counts=Counter(s['version'] for s in entries)
        self.assertEqual(set(counts), {'flash-1.6','flash-1.7','flash-1.8','flash-1.9','flash-2.0','flash-2.1','flash-2.2'})
        self.assertTrue(all(count <= 2 for count in counts.values()))
        self.assertTrue(all(s['status']=='runnable' for s in entries))
    def test_research_line_is_part_of_identity(self):
        entries={e['id']:e for e in systems()}
        self.assertIn('flash-v21',entries)
        self.assertIn('pro-v21',entries)
        self.assertNotEqual(entries['flash-v21']['family'],entries['pro-v21']['family'])
    def test_variant_names_are_preserved(self):
        ids={e['id'] for e in systems()}
        for variant in ['ev2','plan2','sem','sem_select']:
            self.assertIn('flash-v19-'+variant,ids)
        self.assertIn('flash-v17-patch2',ids)

if __name__=='__main__': unittest.main()

#!/usr/bin/env python3
"""Regression for the invalid bspwm pass reported in manual review."""
import unittest
from placement import assert_section_alignment


class PopupPlacement(unittest.TestCase):
    def setUp(self):
        self.section = dict(x=638, y=0, w=253, h=34)
        self.work = dict(x=0, y=34, w=1600, h=966)

    def test_reported_screen_edge_position_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'misses the UsageStat section'):
            assert_section_alignment(dict(x=1131, y=41, w=460, h=529),
                                     self.section, self.work, 'top', 'right')

    def test_matching_section_edges_and_center(self):
        for alignment, x in [('left', 638), ('center', 534.5), ('right', 431)]:
            with self.subTest(alignment=alignment):
                assert_section_alignment(dict(x=x, y=42, w=460, h=529),
                                         self.section, self.work, 'top', alignment)

    def test_side_panel_uses_section_top_and_bottom(self):
        section = dict(x=1566, y=300, w=34, h=120)
        work = dict(x=0, y=0, w=1566, h=1000)
        for alignment, y in [('left', 300), ('center', 160), ('right', 20)]:
            assert_section_alignment(dict(x=1098, y=y, w=460, h=400),
                                     section, work, 'right', alignment)

    def test_clamps_only_at_work_area_boundary(self):
        section = dict(x=0, y=0, w=100, h=34)
        result = assert_section_alignment(dict(x=8, y=42, w=460, h=529),
                                          section, self.work, 'top', 'right')
        self.assertTrue(result['clamped'])

    def test_absent_section_is_not_a_pass(self):
        with self.assertRaisesRegex(AssertionError, 'No measured UsageStat section'):
            assert_section_alignment(dict(x=8, y=42, w=460, h=529),
                                     None, self.work, 'top', 'left')

    def test_native_host_clamps_flush_only_when_needed(self):
        section = dict(x=0, y=0, w=100, h=34)
        result = assert_section_alignment(dict(x=0, y=42, w=460, h=529),
                                          section, self.work, 'top', 'right', inset=0)
        self.assertTrue(result['clamped'])
        with self.assertRaisesRegex(AssertionError, 'misses the UsageStat section'):
            assert_section_alignment(dict(x=0, y=42, w=460, h=529),
                                     self.section, self.work, 'top', 'right', inset=0)


unittest.main()

"""Popup placement assertions against the UsageStat section, never the panel."""


def assert_section_alignment(popup, section, work, edge, alignment, tolerance=4):
    if not section:
        raise AssertionError('No measured UsageStat section bounds; whole-panel alignment is not a substitute.')
    axis, size = ('y', 'h') if edge in ('left', 'right') else ('x', 'w')
    fraction = {'left': 0, 'center': .5, 'right': 1}[alignment]
    # Compare matching edges/centres. Screen clamping is allowed only when
    # that alignment would otherwise put the popup outside the work area.
    target = section[axis] + section[size] * fraction
    desired_start = target - popup[size] * fraction
    start = max(work[axis] + 8, min(desired_start, work[axis] + work[size] - popup[size] - 8))
    error = popup[axis] - start
    assert abs(error) <= tolerance, (
        f'{alignment} alignment misses the UsageStat section by {error:.1f}px: '
        f'popup={popup}, section={section}, expected {axis}={start:.1f}')
    return {'section': section, 'popup': popup, 'alignment': alignment,
            'expectedStart': start, 'errorPixels': error, 'clamped': start != desired_start}

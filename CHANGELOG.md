# Changelog

## master

An in-progress version being developed on the `master` branch.

## 0.20.2 - Oct 3rd, 2017
### Fixed
- `DOMHandler` now calculates mouse position relative to container rather than relative to the page.

## 0.20.1 - June 19th, 2017
### Changed
- Fix bug `lumo.RingCollidable` class where r-tree rectangle was not expanded by halfwidth.

## 0.20.0 - June 19th, 2017
### Added
- `lumo.RingCollidable` class.

## 0.19.0 - June 9th, 2017
### Changed
- Drop `lru-cache` dependency in favor of faster implementation more suited to the TilePyramid requirements.

### Removed
- No longer export the `Browser` utility namespace.

## 0.18.0 - June 8th, 2017
### Added
- `CHANGELOG.md` to help track changes and ease version migration.
- `lumo.PolygonOverlay` and `lumo.PolygonOverlayRenderer` classes.
- `lumo.Bounds.clipPolyline` method for clipping polygons.
- `lumo.IndexBuffer` class for drawing `lumo.VertexBuffer` objects using indices.

### Changed
- `lumo.Bounds.clipLine` now accepts a two component array of points rather than two separate arguments.
- `lumo.Bounds` clip methods return `null` if arguments are outside of the bounds.
- `lumo.LineOverlay` and `lumo.LineOverlayRenderer` renamed to  `lumo.PolylineOverlay` and `lumo.PolylineOverlayRenderer`.

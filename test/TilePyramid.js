(function() {

    'use strict';

    const assert = require('assert');
    const Coord = require('../src/core/Coord');
    const Layer = require('../src/layer/Layer');
    const TilePyramid = require('../src/layer/TilePyramid');

    let layer;

    describe('TilePyramid', () => {

        before(() => {
            layer = new Layer();
            layer.requestTile = (coord, done) => {
                done(null, {});
            };
        });

        after(() => {
            layer = null;
        });

        describe('#constructor()', () => {
            it('should accept a `layer` argument', () => {
                new TilePyramid(layer);
            });
            it('should throw an error if there is no `layer` argument', () => {
                let err = false;
                try {
                    new TilePyramid();
                } catch(e) {
                    err = true;
                }
                assert(err);
            });
        });

        describe('#get()', () => {
            it('should get an active tile from the pyramid', () => {
                const pyramid = new TilePyramid(layer);
                const coord = new Coord(0, 0, 0);
                pyramid.requestTiles([coord]);
                assert(pyramid.get(coord) !== undefined);
            });
            it('should return `undefined` if the pyramid does not contain the tile', () => {
                const pyramid = new TilePyramid(layer);
                const coord = new Coord(0, 0, 0);
                assert(pyramid.get(coord) === undefined);
            });
        });

    });

}());

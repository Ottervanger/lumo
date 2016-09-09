(function() {

    'use strict';

    const esper = require('esper');
    const glm = require('gl-matrix');
    const EventEmitter = require('events');
    const Event = require('./Event');
    const Enum = require('./Enum');
    const Coord = require('./Coord');
    const Const = require('./Const');
    const Bounds = require('./Bounds');
    const Viewport = require('./Viewport');
    const ZoomAnimation = require('./ZoomAnimation');

    // Private Methods

    const mouseToViewPx = function(plot, event) {
        return glm.vec2.fromValues(
            event.clientX,
            plot.viewport.height - event.clientY);
    };

    // const viewPxToPlotPx = function(plot, px) {
    //     return glm.vec2.fromValues(
    //         plot.viewport.pos[0] + px[0],
    //         plot.viewport.pos[1] + px[1]);
    // };

    // const plotPxToViewPx = function(plot, px) {
    //     return glm.vec2.fromValues(
    //         px[0] - plot.viewport.pos[0],
    //         px[1] - plot.viewport.pos[1]);
    // };

    // const mouseToPlotPx = function(plot, event) {
    //     return viewPxToPlotPx(plot, mouseToViewPx(plot, event));
    // };

    const throttle = function(fn, delay, context = this) {
        let lock = false;
        let args;
        let wrapper;
        let unlock = function() {
            // reset lock and call if queued
            lock = false;
            if (args) {
                wrapper.apply(context, args);
                args = false;
            }
        };
        wrapper = function() {
            if (lock) {
                // called too soon, queue to call later
                args = arguments;
            } else {
                // call and lock until later
                fn.apply(context, arguments);
                setTimeout(unlock, delay);
                lock = true;
            }
        };
        return wrapper;
    };

    const zoomRequestTiles = function(plot) {
        const coords = plot.getVisibleCoords(plot.targetViewport, plot.targetZoom);
        plot.layers.forEach(layer => {
            // request tiles
            layer.tiles.zoomRequestTiles(plot, coords);
        });
    };

    const panRequestTiles = function(plot) {
        const coords = plot.getVisibleCoords();
        plot.layers.forEach(layer => {
            // request tiles
            layer.tiles.panRequestTiles(plot, coords);
        });
    };

    const removeTiles = function(plot, zoom, viewport) {
        plot.layers.forEach(layer => {
            // prune out of view tiles
            layer.tiles.pruneOutOfView(plot, zoom, viewport);
        });
    };

    const updateTiles = throttle(function(plot) {
        removeTiles(plot, plot.zoom, plot.viewport);
        panRequestTiles(plot, plot.zoom, plot.viewport);
    }, Const.UPDATE_THROTTLE);

    const pan = function(plot, delta) {
        if (plot.zoomAnimation) {
            // no panning while zooming
            return;
        }
        plot.viewport.pos[0] -= delta[0];
        plot.viewport.pos[1] -= delta[1];
        plot.emit(Event.PAN, delta);
        updateTiles(plot);
    };

    // const center = function(plot, px) {
    //     const half = glm.vec2.fromValues(
    //         plot.viewport.width / 2,
    //         plot.viewport.height / 2);
    //     plot.viewport.pos[0] = px[0] - half[0];
    //     plot.viewport.pos[1] = px[1] - half[1];
    // };

    const zoom = function(plot) {

        // map the delta with a sigmoid function to
        let zoomDelta = plot.wheelDelta / (plot.wheelDeltaPerZoom * Const.MAX_CONCURRENT_ZOOMS);
        zoomDelta = Const.MAX_CONCURRENT_ZOOMS * Math.log(2 / (1 + Math.exp(-Math.abs(zoomDelta)))) / Math.LN2;
        zoomDelta = plot.continuousZoom ? zoomDelta : Math.ceil(zoomDelta);
        zoomDelta = plot.wheelDelta > 0 ? zoomDelta : -zoomDelta;
        zoomDelta = Math.min(Const.MAX_CONCURRENT_ZOOMS, zoomDelta);
        zoomDelta = Math.max(-Const.MAX_CONCURRENT_ZOOMS, zoomDelta);

        // reset wheel delta
        plot.wheelDelta = 0;

        // calculate the target zoom level
        let targetZoom = plot.targetZoom + zoomDelta;
        targetZoom = Math.min(plot.maxZoom, targetZoom);
        targetZoom = Math.max(plot.minZoom, targetZoom);

        if (targetZoom !== plot.targetZoom) {

            console.log('Zooming from ' + plot.zoom + ' to ' + targetZoom);

            // set target zoom
            plot.targetZoom = targetZoom;

            // get the current dimension
            const current = Math.pow(2, plot.zoom);
            // get the next dimension
            const next = Math.pow(2, plot.targetZoom);
            // determine the change in pixels to center the existing plot
            const change = plot.tileSize * (next - current) / 2;

            // set target viewport
            plot.targetViewport = new Viewport(plot.viewport);
            plot.targetViewport.pos[0] += change;
            plot.targetViewport.pos[1] += change;

            // plot zoom timestamp
            plot.zoomAnimation = new ZoomAnimation({
                zoomFrom: plot.zoom,
                zoomTo: plot.targetZoom,
                viewportFrom: new Viewport(plot.viewport)
            });

            // store prev zoom
            plot.prevZoom = plot.zoom;
            // store prev viewport
            plot.prevViewport = glm.vec2.clone(plot.viewport);

            // set zoom direction
            plot.zoomDirection = (plot.zoom < plot.targetZoom) ? Enum.ZOOM_IN : Enum.ZOOM_OUT;

            // emit zoom start
            plot.emit(Event.ZOOM_START, plot);


            // request tiles
            zoomRequestTiles(plot);
        }
    };

    const resize = throttle(function(plot) {
        const width = plot.canvas.offsetWidth;
        const height = plot.canvas.offsetHeight;
        if (plot.viewport.width !== width || plot.viewport.height !== height) {
            // TODO: high res displays
            plot.canvas.width = width;
            plot.canvas.height = height;
            // update viewport
            plot.viewport.width = width;
            plot.viewport.height = height;
            // emit resize
            plot.emit(Event.RESIZE, {});
        }
    }, Const.RESIZE_THROTTLE);

    const render = function(plot) {
        // update size
        resize(plot);
        // get timestamp
        const timestamp = Date.now();
        // clear the backbuffer
        const gl = plot.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        // enable blending
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        if (plot.zoomAnimation) {
            // apply the zoom animation
            plot.zoomAnimation.updatePlot(plot, timestamp);
        }
        // render each layer
        plot.layers.forEach(layer => {
            if (layer.renderer) {
                layer.renderer.draw(timestamp);
            }
        });
        // remove animation once complete
        if (plot.zoomAnimation && plot.zoomAnimation.done()) {
            plot.zoomAnimation = null;
            plot.layers.forEach(layer => {
                // prune out of view tiles
                layer.tiles.pruneOutOfView(plot, plot.zoom, plot.viewport);
            });
            plot.emit(Event.ZOOM_END, plot);
        }
        // request newxt animation frame
        plot.renderQuest = requestAnimationFrame(() => {
            render(plot);
        });
    };

    // Class / Public Methods

    class Plot extends EventEmitter {
        constructor(selector, options = {}) {
            super();
            this.canvas = document.querySelector(selector);
            if (!this.canvas) {
                throw `Element could not be found for selector ${selector}`;
            }
            try {
                this.gl = esper.WebGLContext.get(this.canvas);
            } catch(err) {
                throw `Unable to create a WebGLRenderingContext, please ensure your browser supports WebGL`;
            }
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;

            // set viewport
            this.viewport = new Viewport({
                width: this.canvas.width,
                height: this.canvas.height
            });
            this.prevViewport = new Viewport(this.viewport);
            this.targetViewport = new Viewport(this.viewport);

            this.layers = [];

            this.tileSize = 256;

            this.minZoom = Math.max(Const.MIN_ZOOM, options.minZoom || Const.MIN_ZOOM);
            this.maxZoom = Math.min(Const.MAX_ZOOM, options.maxZoom || Const.MAX_ZOOM);
            this.zoom = Math.min(Const.MAX_ZOOM, Math.max(Const.MIN_ZOOM, options.zoom ? options.zoom : 0));
            this.prevZoom = this.zoom;
            this.targetZoom = this.zoom;
            this.zoomDirection = Enum.ZOOM_IN;

            this.continuousZoom = false;
            this.wheelDelta = 0;
            this.wheelDeltaPerZoom = 60;

            this.tiles = new Map();

            let down = false;
            let last = null;
            this.canvas.addEventListener('mousedown', event => {
                down = true;
                last = mouseToViewPx(this, event);
            });
            document.addEventListener('mouseup', () => {
                down = false;
            });
            document.addEventListener('mousemove', event => {
                if (down) {
                    const current = mouseToViewPx(this, event);
                    const delta = glm.vec2.sub(glm.vec2.create(), current, last);
                    pan(this, delta);
                    last = current;
                }
            });

            this.canvas.addEventListener('dblclick', () => {
                this.wheelDelta += this.wheelDeltaPerZoom;
                zoom(this);
            });

            this.canvas.addEventListener('wheel', event => {
                // if (!this.zoomAnimation) {
                    let delta;
                    if (event.deltaMode === 0) {
                        // pixels
                        delta = -event.deltaY / window.devicePixelRatio;
    		        } else if (event.deltaMode === 1) {
                        // lines
                        delta = -event.deltaY * 20;
                    } else {
                        // pages
                        delta = -event.deltaY * 60;
                    }
                    // if wheel delta is currently 0, kick off the debounce
                    if (this.wheelDelta === 0) {
                        setTimeout(() => {
                            zoom(this);
                        }, Const.ZOOM_DEBOUNCE);
                    }
                    // increment wheel delta
                    this.wheelDelta += delta;
                // }
                // prevent default behavior and stop propagationa
                event.preventDefault();
                event.stopPropagation();
            });

            // render loop
            this.renderRequest = null;
            render(this);
        }
        destroy() {
            // stop animation loop
            cancelAnimationFrame(this.renderRequest);
            this.renderRequest = null;
            // destroy context
            esper.WebGLContext.remove(this.canvas);
            this.gl = null;
            this.canvas = null;
        }
        add(layer) {
            if (!layer) {
                throw `No argument supplied`;
            }
            if (this.layers.indexOf(layer) < 0) {
                this.layers.push(layer);
                layer.activate(this);
            }
            panRequestTiles(this, this.viewport, this.zoom);
        }
        remove(layer) {
            if (!layer) {
                throw `No argument supplied`;
            }
            const index = this.layers.indexOf(layer);
            if (index >= 0) {
                this.layers.splice(index, 1);
                layer.deactivate(this);
            }
        }
        getVisibleCoords(viewport = this.viewport, zoom = this.zoom) {
            const dim = Math.pow(2, zoom);
            // TODO: add wrap-around logic here
            const bounds = new Bounds(
                Math.floor(Math.max(0, viewport.pos[0] / this.tileSize)),
                Math.ceil(Math.min(dim, (viewport.pos[0] + viewport.width) / this.tileSize)),
                Math.floor(Math.max(0, viewport.pos[1] / this.tileSize)),
                Math.ceil(Math.min(dim, (viewport.pos[1] + viewport.height) / this.tileSize)));
            // TODO: pre-allocate this and index
            let coords = [];
            for (let x=bounds.left; x<bounds.right; x++) {
                for (let y=bounds.bottom; y<bounds.top; y++) {
                    coords.push(new Coord(zoom, x, y));
                }
            }
            return coords;
        }
    }

    module.exports = Plot;

}());

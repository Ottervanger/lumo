(function() {

    'use strict';

    const esper = require('esper');
    const EventEmitter = require('events');
    const Event = require('./Event');
    const Enum = require('./Enum');
    const Const = require('./Const');
    const Viewport = require('./Viewport');
    const ZoomAnimation = require('./ZoomAnimation');

    // Private Methods

    const mouseToViewPx = function(plot, event) {
        return {
            x: event.clientX,
            y: plot.viewport.height - event.clientY
        };
    };

    const viewPxToPlotPx = function(plot, px) {
        return {
            x: plot.viewport.x + px.x,
            y: plot.viewport.y + px.y
        };
    };

    // const plotPxToViewPx = function(plot, px) {
    //     return {
    //         x: px.x - plot.viewport.x,
    //         y: px.y - plot.viewport.y
    //     };
    // };

    const mouseToPlotPx = function(plot, event) {
        return viewPxToPlotPx(plot, mouseToViewPx(plot, event));
    };

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
        const coords = plot.targetViewport.getVisibleCoords(
            plot.tileSize,
            plot.targetZoom);
        plot.layers.forEach(layer => {
            // request tiles
            layer.pyramid.zoomRequestTiles(plot, coords);
        });
    };

    const panRequestTiles = function(plot) {
        const coords = plot.viewport.getVisibleCoords(plot.tileSize, plot.zoom);
        plot.layers.forEach(layer => {
            // request tiles
            layer.pyramid.panRequestTiles(plot, coords);
        });
    };

    const removeTiles = function(plot) {
        plot.layers.forEach(layer => {
            // prune out of view tiles
            layer.pyramid.pruneOutOfView(
                plot.tileSize,
                plot.zoom,
                plot.viewport);
        });
    };

    const updateTiles = throttle(function(plot) {
        removeTiles(plot);
        panRequestTiles(plot);
    }, Const.UPDATE_THROTTLE);

    const pan = function(plot, delta) {
        if (plot.zoomAnimation) {
            // no panning while zooming
            return;
        }
        // update current viewport
        plot.viewport.x -= delta.x;
        plot.viewport.y -= delta.y;
        // update target viewport
        plot.targetViewport.x -= delta.x;
        plot.targetViewport.y -= delta.y;
        // emit pan
        plot.emit(Event.PAN, delta);
        updateTiles(plot);
    };

    const zoom = function(plot, targetPx) {

        // map the delta with a sigmoid function to
        let zoomDelta = plot.wheelDelta / (Const.ZOOM_WHEEL_DELTA * Const.MAX_CONCURRENT_ZOOMS);
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

            // set target zoom
            plot.targetZoom = targetZoom;

            // set target viewport
            plot.targetViewport = plot.viewport.zoomFromPlotPx(
                plot.tileSize,
                plot.zoom,
                plot.targetZoom,
                targetPx);

            // set zoom animation
            plot.zoomAnimation = new ZoomAnimation({
                zoomFrom: plot.zoom,
                zoomTo: plot.targetZoom,
                targetPx: targetPx
            });

            // store prev zoom
            plot.prevZoom = plot.zoom;
            // store prev viewport
            plot.prevViewport = new Viewport(plot.viewport);

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
            // resize render target
            plot.renderBuffer.resize(width, height);
            // update viewport
            plot.viewport.width = width;
            plot.viewport.height = height;
            // update target viewport
            plot.targetViewport.width = width;
            plot.targetViewport.height = height;
            // update tiles
            updateTiles(plot);
            // emit resize
            plot.emit(Event.RESIZE, {});
        }
    }, Const.RESIZE_THROTTLE);

    const render = function(plot) {
        // update size
        resize(plot);
        // get timestamp
        const timestamp = Date.now();
        const gl = plot.gl;

        // clear the backbuffer
        gl.clearColor(0, 0, 0, 0);

        // enable blending
        gl.enable(gl.BLEND);

        // set the viewport
        gl.viewport(0, 0, plot.viewport.width, plot.viewport.height);

        // apply the zoom animation
        if (plot.zoomAnimation) {
            plot.zoomAnimation.updatePlot(plot, timestamp);
        }
        // render each layer
        plot.layers.forEach(layer => {
            layer.draw(timestamp);
        });
        // remove animation once complete
        if (plot.zoomAnimation && plot.zoomAnimation.done()) {
            plot.zoomAnimation = null;
            plot.layers.forEach(layer => {
                // prune out of view tiles
                layer.pyramid.pruneOutOfView(
                    plot.tileSize,
                    plot.zoom,
                    plot.viewport);
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

            // set render target
            this.renderTexture = new esper.ColorTexture2D({
                width: this.canvas.offsetWidth,
                height: this.canvas.offsetHeight,
                filter: 'NEAREST',
                wrap: 'CLAMP_TO_EDGE',
                mipMap: false,
                // preMultiplyAlpha: false
            });
            this.renderBuffer = new esper.RenderTarget();
            this.renderBuffer.setColorTarget(this.renderTexture, 0);

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
                    const delta = {
                        x: current.x - last.x,
                        y: current.y - last.y
                    };
                    pan(this, delta);
                    last = current;
                }
            });

            this.canvas.addEventListener('dblclick', () => {
                this.wheelDelta += Const.ZOOM_WHEEL_DELTA;
                zoom(this, mouseToPlotPx(this, event));
            });

            this.canvas.addEventListener('wheel', event => {
                // if (!this.zoomAnimation) {
                    let delta;
                    if (event.deltaMode === 0) {
                        // pixels
                        delta = -event.deltaY;
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
                            zoom(this, mouseToPlotPx(this, event));
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
    }

    module.exports = Plot;

}());

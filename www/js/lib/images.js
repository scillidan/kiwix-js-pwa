﻿/**
 * images.js : Functions for the processing of images
 * 
 * Copyright 2013-2019 Mossroy and contributors
 * License GPL v3:
 * 
 * This file is part of Kiwix.
 * 
 * Kiwix is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Kiwix is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Kiwix (file LICENSE-GPLv3.txt).  If not, see <http://www.gnu.org/licenses/>
 */
'use strict';

define(['uiUtil'], function (uiUtil) {

    /**
     * The Window on which to operate
     */
    var container;

    /**
     * A variable to keep track of how many images are being extracted by the extractor
     */
    var extractorBusy = 0;

    /**
     * A variable to signal that the current image processing queue should be abandoned (e.g. because user scrolled)
     */
    var abandon = false;

    /**
     * A regular expression to find or transform image URLs in an article
     * DEV: make sure list of file types here is the same as the list in Service Worker code
     */
     var imageURLRegexp =  /(^|\/).+\.(jpe?g|png|svg|gif|webp)($|[?#])/i;

    /**
     * A regular expression to find MathTex in an image
     */
    var transformMathTextRegexp = /<img\s+(?=[^>]+?math-fallback-image)[^>]*?alt\s*=\s*(['"])((?:[^"']|(?!\1)[\s\S])+)[^>]+>/ig;

    /**
     * Iterates over an array or collection of image nodes, extracting the image data from the ZIM
     * and inserting a BLOB URL to each image in the image's src attribute
     * 
     * @param {Object} images An array or collection of DOM image nodes
     * @param {Function} callback An optional function to call when all requested images have been loaded
     */
    function extractImages(images, callback) {
        var remaining = images.length;
        if (!remaining && callback) callback();
        var checkBatch = function () {
            extractorBusy--;
            remaining--;
            if (!remaining && callback) callback();
            if (!remaining) queueImages();
        };
        Array.prototype.slice.call(images).forEach(function (image) {
            var imageUrl = image.getAttribute('data-kiwixurl');
            if (!imageUrl) { remaining--; return; }
            // Create data-kiwixsrc needed for stylesheets
            else { image.setAttribute('data-kiwixsrc', imageUrl); } 
            image.removeAttribute('data-kiwixurl');
            var title = decodeURIComponent(imageUrl);
            extractorBusy++;
            if (/^data:image\/webp/i.test(imageUrl)) {
                image.style.transition = 'opacity 0.5s ease-in';
                image.style.opacity = '1';
                uiUtil.feedNodeWithBlob(image, 'src', imageUrl, 'image/webp', params.manipulateImages || params.allowHTMLExtraction, function () {
                    checkBatch();
                });
                return;
            }
            if (params.contentInjectionMode === 'serviceworker' && !(params.manipulateImages || params.allowHTMLExtraction)) {
                var transition = function () {
                    image.style.transition = 'opacity 0.5s ease-in';
                    image.style.opacity = '1';
                    removeEventListener('load', transition);
                }
                image.addEventListener('load', transition);
                // Let's remove kiwix-display from the end of the url so that the SW will ask for the image
                image.src = imageUrl.replace(/\?kiwix-display/, '');
                // Timeout allows the loop to complete so we get an accurate busy count
                setTimeout(function () {
                    checkBatch();
                });
                return;
            }
            // Zimit files (at least) will sometimes have a ZIM prefix, but we are extracting raw here
            title = title.replace(appstate.selectedArchive._file.name + '/', '');
            // Zimit files store URLs encoded!
            if (params.zimType === 'zimit') title = encodeURI(title);
            appstate.selectedArchive.getDirEntryByPath(title).then(function (dirEntry) {
                return appstate.selectedArchive.readBinaryFile(dirEntry, function (fileDirEntry, content) {
                    image.style.background = '';
                    var mimetype = dirEntry.getMimetype();
                    uiUtil.feedNodeWithBlob(image, 'src', content, mimetype, params.manipulateImages || params.allowHTMLExtraction, function () {
                        checkBatch();
                    });
                    image.style.transition = 'opacity 0.5s ease-in';
                    image.style.opacity = '1';
                });
            }).catch(function (e) {
                console.error('Could not find DirEntry for image: ' + title, e);
                checkBatch();
            });
        });
    }

    /**
     * Iterates over an array or collection of image nodes, preparing each node for manual image
     * extraction when user taps the indicated area
     * 
     */
    function prepareManualExtraction(win) {
        container = win;
        var doc = container.document;
        var documentImages = doc.querySelectorAll('img');
        for (var i = 0, l = documentImages.length; i < l; i++) {
            var originalHeight = documentImages[i].getAttribute('height') || '';
            //Ensure 36px clickable image height so user can request images by tapping
            documentImages[i].height = '36';
            documentImages[i].style.background = 'lightblue';
            documentImages[i].style.opacity = '1';
            documentImages[i].dataset.kiwixheight = originalHeight;
            documentImages[i].addEventListener('click', function (e) {
                // Line below ensures documentImages remains in scope
                var thisImage = e.currentTarget;
                // Exit function if image was already extracted
                if (!thisImage.dataset.kiwixurl) return;
                // Cancel event bubbling, so that we don't navigate away from the article if the image is hyperlinked
                e.preventDefault();
                e.stopPropagation();
                // DEV: Algorithm below doesn't queue webp images correctly, so for now we will extract images
                // only one-by-one on image click
                // var visibleImages = queueImages('poll', 0, function() { extractImages(visibleImages); }).visible;
                // visibleImages.forEach(function (image) { 
                //    image.style.opacity = '0';
                //    if (image.dataset.kiwixheight) image.height = image.dataset.kiwixheight;
                //    else image.removeAttribute('height');
                //});
                thisImage.style.opacity = '0';
                if (thisImage.dataset.kiwixheight) thisImage.height = thisImage.dataset.kiwixheight;
                else thisImage.removeAttribute('height');
                extractImages([thisImage]);
            });
        }
    }

    // Image store is a buffer for images that are waiting for the extractor to finish
    var imageStore = [];
    var maxImageBatch = 1;

    /**
     * Sorts an array or collection of image nodes, returning a list of those that are inside the visible viewport 
     * 
     * @param {Array} docImgs The array of images to process
     * @param {String} action If null, imageStore only will be processed; if 'extract', documentImages in viewport will be 
     *     extracted; if 'poll', will just return the visible and remaining image arrays
     * @param {Number} margin An extra margin to add to the top (-) or bottom (+) of windows.innerHeight
     * @param {Function} callback Function to call when last image has been extracted (only called if <extract> is true)
     * @returns {Object} An object with two arrays of images, visible and remaining
     */
    function queueImages(docImgs, action, margin, callback) {
        if (abandon) {
            for (var q = imageStore.length; q--;) {
                imageStore[q].queued = false;
            }
            //console.log('User scrolled: abandoning image queue...')
            imageStore = [];
        }
        if (imageStore.length && !extractorBusy) {
            extractImages(imageStore.splice(0, imageStore.length < maxImageBatch ? imageStore.length : maxImageBatch));
        }
        if (!action || !docImgs.length) { if (callback) setTimeout(callback); return; }
        margin = margin || 0;
        var visible = [];
        var remaining = [];
        var batchCount = 0;
        //console.log('Images requested...');
        for (var i = 0, l = docImgs.length; i < l; i++) {
            if (docImgs[i].queued || !docImgs[i].dataset.kiwixurl) continue;
            if (uiUtil.isElementInView(container, docImgs[i], null, margin)) {
                visible.push(docImgs[i]);
                if (action !== 'extract') continue;
                docImgs[i].queued = true;
                if (extractorBusy < maxImageBatch) {
                    batchCount++;
                    console.log('Extracting image #' + i);
                    extractImages([docImgs[i]], function () {
                        batchCount--;
                        if (callback && !batchCount) callback();
                    });
                } else {
                    console.log('Queueing image #' + i);
                    imageStore.push(docImgs[i]);
                }
            } else {
                remaining.push(docImgs[i]);
            } 
        }
        // Callback has to be run inside a timeout because receiving function will expect the visible and remaining arrays to
        // have been returned before running callback code; NB if images have been scheduled for extraction, callback will be
        // called above instead of here, but we still need this in case there are no immediately visible images
        if (callback && !batchCount) setTimeout(callback);
        return { 'visible': visible, 'remaining': remaining };
    }

    /**
     * Prepares the article container in order to process the image nodes that have been disabled in Service Worker
     * 
     * @param {Window} win The Window of the iframe tab that contains the document
     * @param {Boolean} forPrinting If true, extracts all images
     */
    function prepareImagesServiceWorker (win, forPrinting) {
        container = win;
        var doc = container.document;
        var documentImages = doc.querySelectorAll('img:not([src^="data:"])');
        // Schedule loadMathJax here in case next line aborts this function
        setTimeout(function() {
            loadMathJax();
        }, 1000);
        if (!forPrinting && !documentImages.length) return;
        var imageHtml;
        var indexRoot = window.location.pathname.replace(/[^\/]+$/, '') + encodeURI(appstate.selectedArchive._file.name) + '/';
        for (var i = 0, l = documentImages.length; i < l; i++) {
            // Process Wikimedia MathML, but not if we'll be using the jQuery routine later
            if (!(params.manipulateImages || params.allowHTMLExtraction)) {
                imageHtml = documentImages[i].outerHTML;
                if (params.useMathJax && /\bmath\/tex\b/i.test(imageHtml)) {
                    params.containsMathTex = true;
                    documentImages[i].outerHTML = imageHtml.replace(transformMathTextRegexp, function (p0, p1, math) {
                        // Remove any rogue ampersands in MathJax due to double escaping (by Wikipedia)
                        math = math.replace(/&amp;/g, '&');
                        return '<script type="math/tex">' + math + '</script>';
                    });
                }
            }
            // Remove unneeded proprietary lazyload
            documentImages[i].removeAttribute('loading');
            // We exempt images that are from the file system
            if (!~documentImages[i].getAttribute('src').indexOf(window.location.protocol)) {
                documentImages[i].dataset.kiwixurl = documentImages[i].getAttribute('src');
                if (params.imageDisplayMode === 'progressive') {
                    documentImages[i].style.opacity = '0';
                }
                if (params.manipulateImages || params.allowHTMLExtraction) {
                    documentImages[i].outerHTML = documentImages[i].outerHTML.replace(params.regexpTagsWithZimUrl, function(match, blockStart, equals, quote, relAssetUrl, blockEnd) {
                        var parameters = relAssetUrl.replace(/^[^?]+/, '');
                        var assetZIMUrlEnc;
                        if (params.zimType === 'zimit' && !relAssetUrl.indexOf(indexRoot)) {
                            assetZIMUrlEnc = relAssetUrl.replace(indexRoot, '');
                        } else {
                            // DEV: Note that deriveZimUrlFromRelativeUrl produces a *decoded* URL (and incidentally would remove any URI component
                            // if we had captured it). We therefore re-encode the URI with encodeURI (which does not encode forward slashes) instead
                            // of encodeURIComponent.
                            assetZIMUrlEnc = encodeURI(uiUtil.deriveZimUrlFromRelativeUrl(relAssetUrl, params.baseURL)) + parameters;
                        }
                        return blockStart + 'data-kiwixurl' + equals + assetZIMUrlEnc + blockEnd;
                    });
                }
            }
        }
        if (params.manipulateImages || params.allowHTMLExtraction) {
            prepareImagesJQuery(win, forPrinting);
            return;
        }

        if (forPrinting) {
            if (params.preloadAllImages) uiUtil.pollSpinner();
            extractImages(documentImages, params.preloadingAllImages ? params.preloadAllImages : params.printImagesLoaded);
        } else {
            if (params.imageDisplayMode === 'manual') {
                prepareManualExtraction(container);
            } else {
                // Extract all images if we are on the landing page
                if (params.isLandingPage) {
                    setTimeout(function () {
                        extractImages(documentImages);
                    }, 0);
                } else {
                    // We need to start detecting images after the hidden articleContent has been displayed (otherwise they are not detected)
                    setTimeout(function() {
                        lazyLoad(documentImages);
                    }, 400);
                }
            }
        }
    }

    /**
     * Prepares the article container in order to process the image nodes that have been disabled in the DOM
     * 
     * @param {Window} win The Window of the iframe or tab that contains the document
     * @param {Boolean} forPrinting If true, extracts all images
     */
    function prepareImagesJQuery (win, forPrinting) {
        container = win;
        var doc = container.document;
        var documentImages = doc.querySelectorAll('img[data-kiwixurl]');
        var indexRoot = window.location.pathname.replace(/[^\/]+$/, '') + encodeURI(appstate.selectedArchive._file.name) + '/';
        indexRoot = indexRoot.replace(/^\//, '');
        // Zimit ZIMs work better if all images are extracted
        if (params.zimType === 'zimit') forPrinting = true;
        // In case there are no images in the doc, we need to schedule the loadMathJax function here
        setTimeout(function() {
            loadMathJax();
        }, 1000);
        if (!forPrinting && !documentImages.length) return;
        // Firefox squashes empty images, but we don't want to alter the vertical heights constantly as we scroll
        // so substitute empty images with a plain svg
        var image;
        for (var i = documentImages.length; i--;) {
            image = documentImages[i];
            image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
            image.style.opacity = '0';
            // Set a minimum width to avoid some images not rendering in squashed hidden tables
            if (params.displayHiddenBlockElements && image.width && !image.style.minWidth && 
                /wiki|wiktionary/i.test(appstate.selectedArchive._file.name)) {
                var imgX = image.width + '';
                imgX = imgX.replace(/(\d+)$/, '$1px');
                image.style.minWidth = imgX;
            }
            if (params.zimType === 'zimit' && !(image.dataset.kiwixurl).indexOf(indexRoot)) {
                image.dataset.kiwixurl = image.dataset.kiwixurl.replace(indexRoot, '');
            }
        }

        if (forPrinting) {
            extractImages(documentImages, params.preloadingAllImages ? params.preloadAllImages : params.printImagesLoaded);
        } else if (params.imageDisplayMode === 'progressive') {
            // Extract all images if we are on the landing page
            if (params.isLandingPage) {
                setTimeout(function () {
                    extractImages(documentImages);
                }, 0);
            } else {
                // We need to start detecting images after the hidden articleContent has been displayed (otherwise they are not detected)
                setTimeout(function() {
                    lazyLoad(documentImages);
                }, 400);
            }
        } else {
            // User wishes to extract images manually
            prepareManualExtraction(container);
        }
    }

    /**
     * Processes an array or collection of image nodes so that they will be lazy loaded (progressive extraction)
     * 
     * @param {Object} documentImages An array or collection of DOM image nodes which will be processed for 
     *        progressive image extraction 
     */
    function lazyLoad(documentImages) {
        // The amount by which to offset the second reading of the viewport
        var offset = window.innerHeight * 2;
        // Perform an immediate extraction of visible images so as not to disconcert the user
        // We request images twice because frequently the position of all of them is not known at this stage in rendering
        queueImages(documentImages, 'extract', 0, function () {
            queueImages(documentImages, 'extract', offset);
        });
        if (!documentImages.length) return;
        // There are images remaining, so set up an event listener to load more images once user has stopped scrolling the iframe or window
        var scrollPos;
        // var rateLimiter = 0;
        var rate = 8; // DEV: Set the milliseconds to wait before allowing another iteration of the image stack
        var timeout;
        // NB we add the event listener this way so we can access it in app.js
        container.onscroll = function () {
            abandon = true;
            clearTimeout(timeout);
            var velo = container.pageYOffset - scrollPos;
            timeout = setTimeout(function() {
                // We have stopped scrolling
                //console.log("Stopped scrolling; velo=" + velo);
                queueImages(documentImages);
                abandon = false;
                queueImages(documentImages, 'extract', 0, function() {
                    queueImages(documentImages, 'extract', velo >= 0 ? offset : -offset);
                });
            }, rate);
            scrollPos = container.pageYOffset;
        };
    }

    /**
     * Attaches KaTeX scripts to the window of the document, if there is MathML to process
     * 
     * @param {Object} win The window that contains the document to be processed 
     * @returns {Null} Returns null if the function was aborted
     */
    function loadMathJax(win) {
        if (!params.useMathJax) return;
        container = container || win;
        var doc = container.document;
        var prefix = '';
        if (params.contentInjectionMode === 'serviceworker') {
            params.containsMathSVG = /<img\s+(?=[^>]+?math-fallback-image)[^>]*?alt\s*=\s*['"][^'"]+[^>]+>/i.test(doc.body.innerHTML);
            prefix = document.location.href.replace(/index\.html(?:$|[#?].*$)/, '');
        }
        if (params.containsMathTexRaw || params.containsMathTex || params.containsMathSVG) {
            var script1, script2, script3;
            var link = doc.createElement("link");
            link.rel = "stylesheet";
            link.href = prefix + "js/katex/katex.min.css";
            doc.head.appendChild(link);
            script1 = doc.createElement("script");
            script1.type = "text/javascript";
            //script.src = "js/MathJax/MathJax.js?config=TeX-AMS_HTML-full";
            script1.src = prefix + "js/katex/katex.min.js";
            if (params.containsMathTex) {
                script2 = doc.createElement("script");
                script2.type = "text/javascript";
                script2.src = prefix + "js/katex/contrib/mathtex-script-type.min.js";
            }
            if (params.containsMathTex || params.containsMathTexRaw) {
                script3 = doc.createElement("script");
                script3.type = "text/javascript";
                script3.src = prefix + "js/katex/contrib/auto-render.min.js";
                script3.onload = function() {
                    container.renderMathInElement(doc.body, { 
                        delimiters: [
                            {left: "$$", right: "$$", display: true},
                            {left: "$", right: "$", display: false},
                            {left: "\\(", right: "\\)", display: false},
                            // {left: "\\begin{equation}", right: "\\end{equation}", display: true},
                            // {left: "\\begin{align}", right: "\\end{align}", display: true},
                            // {left: "\\begin{alignat}", right: "\\end{alignat}", display: true},
                            // {left: "\\begin{gather}", right: "\\end{gather}", display: true},
                            // {left: "\\begin{CD}", right: "\\end{CD}", display: true},
                            {left: "\\[", right: "\\]", display: true}
                        ],
                        globalGroup: true,
                        throwOnError: false
                    });
                };
            }
            script1.onload = function () {
                if (script2) doc.body.appendChild(script2);
                if (script3) doc.body.appendChild(script3);
            };
            doc.body.appendChild(script1);
            // if (params.containsMathTex || params.containsMathTexRaw) script.innerHTML = 'MathJax.Hub.Queue(["Typeset", MathJax.Hub]); \
            //     console.log("Typesetting maths with MathJax");';
            params.containsMathTexRaw = false; //Prevents doing a second Typeset run on the same document
            params.containsMathTex = false;
        }
    }

    /**
     * Functions and classes exposed by this module
     */
    return {
        extractImages: extractImages,
        setupManualImageExtraction: prepareManualExtraction,
        prepareImagesServiceWorker: prepareImagesServiceWorker,
        prepareImagesJQuery: prepareImagesJQuery,
        lazyLoad: lazyLoad,
        loadMathJax: loadMathJax
    };
});

﻿/**
 * uiUtil.js : Utility functions for the User Interface
 * 
 * Copyright 2013-2014 Mossroy and contributors
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
define([], function() {
    
    /**
     * Creates a Blob from the given content, then a URL from this Blob
     * And put this URL in the attribute of the DOM node
     * 
     * This is useful to inject images (and other dependencies) inside an article
     * 
     * @param {Object} jQueryNode
     * @param {String} nodeAttribute
     * @param {Uint8Array} content
     * @param {String} mimeType
     */
    function feedNodeWithBlob(node, nodeAttribute, content, mimeType) {
        var blob = new Blob([content], { type: mimeType });
        var url = URL.createObjectURL(blob);
        /*jQueryNode.on('load', function () {
            URL.revokeObjectURL(url);
        });*/
        node.setAttribute(nodeAttribute, url);
    }
        
    var regexpRemoveUrlParameters = new RegExp(/([^\?]+)\?.*$/);
    
    function removeUrlParameters(url) {
        if (regexpRemoveUrlParameters.test(url)) {
            return regexpRemoveUrlParameters.exec(url)[1];
        } else {
            return url;
        }
    }

    function TableOfContents(articleDoc) {
        this.doc = articleDoc;
        this.headings = this.doc.querySelectorAll("h1, h2, h3, h4, h5, h6");

        this.getHeadingObjects = function () {
            var headings = [];
            for (var i = 0; i < this.headings.length; i++) { 
                var element = this.headings[i];
                var obj = {};
                obj.id = element.id;
                var objectId = element.innerHTML.match(/\bid\s*=\s*["']\s*([^"']+?)\s*["']/i);
                obj.id = obj.id ? obj.id : objectId && objectId.length > 1 ? objectId[1] : "";
                obj.index = i;
                obj.textContent = element.textContent;
                obj.tagName = element.tagName;
                headings.push(obj);
            }
            return headings;
        }
    }

    /**
     * Checks whether an element is fully or partially in view
     * This is useful for progressive download of images inside an article
     *
     * @param {Object} el
     * @param {Boolean} fully
     */
    function isElementInView(el, fully) {
        var elemTop = el.getBoundingClientRect().top;
        var elemBottom = el.getBoundingClientRect().bottom;

        var isVisible = fully ? elemTop < window.innerHeight && elemBottom >= 0 :
            elemTop >= 0 && elemBottom <= window.innerHeight;
        return isVisible;
    }


    function makeReturnLink(title) {
        //Abbreviate title if necessary
        var shortTitle = title.substring(0, 25);
        shortTitle = shortTitle == title ? shortTitle : shortTitle + "..."; 
        var link = '<h4 style="font-size:' + ~~(params.relativeUIFontSize * 1.4 * 0.14) + 'px;"><a href="#">&lt;&lt; Return to ' + shortTitle + '</a></h4>';
        var rtnFunction = "(function () { setTab(); \
            if (params.themeChanged) { \
                params.themeChanged = false; \
                if (history.state !== null) {  \
                    var thisURL = decodeURIComponent(history.state.title); \
                    goToArticle(thisURL); \
                } \
            } \
        })";
        var returnDivs = document.getElementsByClassName("returntoArticle");
        for (var i = 0; i < returnDivs.length; i++) {
            returnDivs[i].innerHTML = link;
        }
        return rtnFunction;
    }

    function poll(msg) {
        document.getElementById('searchingArticles').style.display = 'block';
        document.getElementById('progressMessage').innerHTML = msg;
        document.getElementById('progressMessage').style.display = 'block';
    }

    function clear() {
        document.getElementById('progressMessage').innerHTML = '';
        document.getElementById('progressMessage').style.display = 'none';
    }

  /**
  * Initiates XMLHttpRequest
  * Can be used for loading local files in app context
  *
  * @param {String} file
  * @param {Function} callback
  * @param {responseType} responseType
  * @returns responseText, status
  */
    function XHR(file, callback, responseType) {
        var xhr = new XMLHttpRequest();
        if (responseType) xhr.responseType = responseType;
        xhr.onreadystatechange = function (e) {
            if (this.readyState == 4) {
                callback(this.response, this.response.type, this.status);
            }
        };
        var err = false;
        try {
            xhr.open('GET', file, true);
        }
        catch (e) {
            console.log("Exception during GET request: " + e);
            err = true;
        }
        if (!err) {
            xhr.send();
        } else {
            callback("Error", 500);
        }
    }

    function printCustomElements() {
        var innerDocument = window.frames[0].frameElement.contentDocument;
        //Add any missing classes
        innerDocument.body.innerHTML = innerDocument.body.innerHTML.replace(/(class\s*=\s*["'][^"']*vcard\b[^>]+>\s*<span)>/ig, '$1 class="map-pin">');
        innerDocument.body.innerHTML = innerDocument.body.innerHTML.replace(/(<h2\b[^<]+external_links(?:[^<]|<\/)+<ul\s+(?!class="externalLinks"))/i, '$1class="externalLinks" ');
        innerDocument.body.innerHTML = innerDocument.body.innerHTML.replace(/(<h2\b[^<]+see_also(?:[^<]|<\/)+<ul\s+(?!class="seeAlso"))/i, '$1class="seeAlso" ');
        innerDocument.body.innerHTML = innerDocument.body.innerHTML.replace(/(<div\s+)([^>]+>\s+This article is issued from)/i, '$1class="copyLeft" $2');
        var printOptions = innerDocument.getElementById("printOptions");
        //If there is no printOptions style block in the iframe, create it
        if (!printOptions) {
            var printStyle = innerDocument.createElement("style");
            printStyle.id = "printOptions";
            innerDocument.head.appendChild(printStyle);
            printOptions = innerDocument.getElementById("printOptions");
        }
        var printStyleInnerHTML = "@media print { ";
        printStyleInnerHTML += document.getElementById("printNavBoxCheck").checked ? "" : ".navbox, .vertical-navbox { display: none; } ";
        printStyleInnerHTML += document.getElementById("printEndNoteCheck").checked ? "" : ".reflist { display: none; } ";
        printStyleInnerHTML += document.getElementById("externalLinkCheck").checked ? "" : ".externalLinks { display: none; } ";
        printStyleInnerHTML += document.getElementById("seeAlsoLinkCheck").checked ? "" : ".seeAlso { display: none; } ";
        printStyleInnerHTML += document.getElementById("printInfoboxCheck").checked ? "" : ".mw-stack, .infobox, .infobox_v2, .infobox_v3, .qbRight, .qbRightDiv, .wv-quickbar, .wikitable { display: none; } ";
        printStyleInnerHTML += document.getElementById("printImageCheck").checked ? "" : "img { display: none; } ";
        printStyleInnerHTML += ".copyLeft { display: none } ";
        printStyleInnerHTML += ".map-pin { display: none } ";
        printStyleInnerHTML += ".external { padding-right: 0 !important } ";
        var sliderVal = document.getElementById("documentZoomSlider").value;
        sliderVal = ~~sliderVal;
        sliderVal = Math.floor(sliderVal * (Math.max(window.screen.width, window.screen.height) / 1440)); 
        printStyleInnerHTML += "body { font-size: " + sliderVal + "% !important; } ";
        printStyleInnerHTML += "}";
        printOptions.innerHTML = printStyleInnerHTML;
    }

    function downloadBlobUWP(blob, filename, message) {
        // Copy BLOB to downloads folder and launch from there in Edge
        // First create an empty file in the folder
        Windows.Storage.DownloadsFolder.createFileAsync(filename, Windows.Storage.CreationCollisionOption.generateUniqueName)
        .then(function (file) {
            // Open the returned dummy file in order to copy the data into it
            file.openAsync(Windows.Storage.FileAccessMode.readWrite).then(function (output) {
                // Get the InputStream stream from the blob object 
                var input = blob.msDetachStream();
                // Copy the stream from the blob to the File stream 
                Windows.Storage.Streams.RandomAccessStream.copyAsync(input, output).then(function () {
                    output.flushAsync().done(function () {
                        input.close();
                        output.close();
                        // Finally, tell the system to open the file if it's not a subtitle file
                        if (!/\.(?:ttml|ssa|ass|srt|idx|sub|vtt)$/i.test(filename)) Windows.System.Launcher.launchFileAsync(file);
                        if (file.isAvailable) {
                            var fileLink = file.path.replace(/\\/g, '/');
                            fileLink = fileLink.replace(/^([^:]+:\/(?:[^/]+\/)*)(.*)/, function (p0, p1, p2) {
                                return 'file:///' + p1 + encodeURIComponent(p2);
                            });
                            if (message) message.innerHTML = '<strong>Download:</strong> Your file was saved as <a href="' +
                                fileLink + '" target="_blank" class="alert-link">' + file.path + '</a>';
                            //window.open(fileLink, null, "msHideView=no");
                        }
                    });
                });
            });
        }); 
    }

    /**
     * Displays a Bootstrap warning alert with information about how to access content in a ZIM with unsupported active UI
     */
    function displayActiveContentWarning() {
        // We have to add the alert box in code, because Bootstrap removes it completely from the DOM when the user dismisses it
        var alertHTML =
            '<div id="activeContent" class="alert alert-warning alert-dismissible fade in">' +
                '<a href="#" class="close" data-dismiss="alert" aria-label="close">&times;</a>' +
                '<strong>Unable to display active content:</strong> To use Archive Index <b><i>type a space</b></i> in the box above. ' +
                '&nbsp;[<a id="stop" href="#displaySettingsDiv" class="alert-link">Permanently hide</a>]' +
            '</div>';
        document.getElementById('alertBoxHeader').innerHTML = alertHTML;
        ['stop'].forEach(function (id) {
            // Define event listeners for both hyperlinks in alert box: these take the user to the Config tab and highlight
            // the options that the user needs to select
            document.getElementById(id).addEventListener('click', function () {
                var elementID = id === 'stop' ? 'hideActiveContentWarningCheck' : 'serviceworkerModeRadio';
                var thisLabel = document.getElementById(elementID).parentNode;
                thisLabel.style.borderColor = 'red';
                thisLabel.style.borderStyle = 'solid';
                var btnHome = document.getElementById('btnHome');
                [thisLabel, btnHome].forEach(function (ele) {
                    // Define event listeners to cancel the highlighting both on the highlighted element and on the Home tab
                    ele.addEventListener('mousedown', function () {
                        thisLabel.style.borderColor = '';
                        thisLabel.style.borderStyle = '';
                    });
                });
                document.getElementById('btnConfigure').click();
            });
        });
    }

    /**
     * Displays a Bootstrap alert box at the foot of the page to enable saving the content of the given title to the device's filesystem
     * and initiates download/save process if this is supported by the OS or Browser
     * 
     * @param {String} title The path and filename to the file to be extracted
     * @param {Boolean|String} download A Bolean value that will trigger download of title, or the filename that should
     *     be used to save the file in local FS
     * @param {String} contentType The mimetype of the downloadable file, if known
     * @param {Uint8Array} content The binary-format content of the downloadable file
     */
    function displayFileDownloadAlert(title, download, contentType, content) {
        // We have to create the alert box in code, because Bootstrap removes it completely from the DOM when the user dismisses it
        if (download) {
            document.getElementById('alertBoxFooter').innerHTML =
                '<div id="downloadAlert" class="alert alert-info alert-dismissible">' +
                '    <a href="#" class="close" data-dismiss="alert" aria-label="close">&times;</a>' +
                '    <span id="alertMessage"></span>' +
                '</div>';
        }
        // Download code adapted from https://stackoverflow.com/a/19230668/9727685 
        if (!contentType) {
            // DEV: Add more contentTypes here for downloadable files
            if (/\.epub$/.test(title)) contentType = 'application/epub+zip';
            if (/\.pdf$/.test(title)) contentType = 'application/pdf';
            if (/\.zip$/.test(title)) contentType = 'application/zip';
        }
        // Set default contentType if there has been no match
        if (!contentType) contentType = 'application/octet-stream';
        var a = document.createElement('a');
        var blob = new Blob([content], { 'type': contentType });
        // If the filename to use for saving has not been specified, construct it from title
        var filename = (!download || download === true) ? title.replace(/^.*\/([^\/]+)$/, '$1') : download;
        // Make filename safe
        filename = filename.replace(/[\/\\:*?"<>|]/g, '_');
        a.href = window.URL.createObjectURL(blob);
        a.target = '_blank';
        a.type = contentType;
        a.download = filename;
        a.classList.add('alert-link');
        a.innerHTML = filename;
        var alertMessage = download ? document.getElementById('alertMessage') : null;
        if (download) {
            alertMessage.innerHTML = '<strong>Download</strong> If the download does not start, please tap the following link: ';
            // We have to add the anchor to a UI element for Firefox to be able to click it programmatically: see https://stackoverflow.com/a/27280611/9727685
            alertMessage.appendChild(a);
        }
        try { a.click(); }
        catch (err) {
            // If the click fails, user may be able to download by manually clicking the link
            // But for IE11 we need to force use of the saveBlob method with the onclick event 
            if (window.navigator && window.navigator.msSaveBlob) {
                a.addEventListener('click', function (e) {
                    window.navigator.msSaveBlob(blob, filename);
                    e.preventDefault();
                });
            } else {
                // And try to launch through UWP download
                if (Windows && Windows.Storage) downloadBlobUWP(blob, filename, alertMessage);
            }
        }
        $("#searchingArticles").hide();
    }

    /**
     * Functions and classes exposed by this module
     */
    return {
        feedNodeWithBlob: feedNodeWithBlob,
        removeUrlParameters: removeUrlParameters,
        toc: TableOfContents,
        isElementInView: isElementInView,
        makeReturnLink: makeReturnLink,
        poll: poll,
        clear: clear,
        XHR: XHR,
        printCustomElements: printCustomElements,
        downloadBlobUWP: downloadBlobUWP,
        displayActiveContentWarning: displayActiveContentWarning,
        displayFileDownloadAlert: displayFileDownloadAlert
    };
});

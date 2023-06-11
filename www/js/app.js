﻿/*!
 * app.js : The main Kiwix User Interface implementation
 * This file handles the interaction between the Kiwix JS back end and the user
 * 
 * Copyright 2013-2023 Mossroy, Jaifroid and contributors
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

// import styles from '../css/app.css' assert { type: "css" };
// import bootstrap from '../css/bootstrap.min.css' assert { type: "css" }; 
import $ from './lib/jquery.module.js';
import zimArchiveLoader from './lib/zimArchiveLoader.js';
import uiUtil from './lib/uiUtil.js';
import util from './lib/util.js';
import utf8 from './lib/utf8.js';
import cache from './lib/cache.js';
import images from './lib/images.js';
import settingsStore from './lib/settingsStore.js';
import transformStyles from './lib/transformStyles.js';
import transformZimit from './lib/transformZimit.js';
import kiwixServe from './lib/kiwixServe.js';
import updater from './lib/updater.js';

// Import stylesheets programmatically
// document.adoptedStyleSheets = [styles, bootstrap];

/**
 * The delay (in milliseconds) between two "keepalive" messages
 * sent to the ServiceWorker (so that it is not stopped by
 * the browser, and keeps the MessageChannel to communicate
 * with the application)
 * @type Integer
 */
var DELAY_BETWEEN_KEEPALIVE_SERVICEWORKER = 30000;

// Define global state:

// Placeholders for the article container, the article window and the article DOM
var articleContainer = document.getElementById('articleContent');
articleContainer.kiwixType = 'iframe';
var articleWindow = articleContainer.contentWindow;
var articleDocument;

/**
 * @type ZIMArchive
 */
appstate.selectedArchive = null;

// An object to hold the current search and its state (allows cancellation of search across modules)
appstate['search'] = {
    'prefix': '', // A field to hold the original search string
    'status': '', // The status of the search: ''|'init'|'interim'|'cancelled'|'complete'
    'type': '' // The type of the search: 'basic'|'full' (set automatically in search algorithm)
};

// A parameter to determine the Settings Store API in use (we need to nullify before testing
// because params.storeType is also set in a preliminary way in init.js)
params['storeType'] = null;
params['storeType'] = settingsStore.getBestAvailableStorageAPI();

// Placeholder for the alert box header element, so it can be displayed and hidden easily
const alertBoxHeader = document.getElementById('alertBoxHeader');

// Test caching capability
cache.test(function(){});
// Unique identifier of the article expected to be displayed
appstate.expectedArticleURLToBeDisplayed = '';
// Check if we have managed to switch to PWA mode (if running UWP app)
// DEV: we do this in init.js, but sometimes it doesn't seem to register, so we do it again once the app has fully launched
if (/UWP\|PWA/.test(params.appType) && /^http/i.test(window.location.protocol)) {
    // We are in a PWA, so signal success
    params.localUWPSettings.PWA_launch = 'success';
}
// Failsafe for Windows XP version
if (params.contentInjectionMode === 'serviceworker' && window.nw) {
    // Reset app to jQuery mode because it cannot run in SW mode in Windows XP
    if (nw.process.versions.nw === '0.14.7') setContentInjectionMode('jquery');
}
// Make Configuration headings collapsible 
uiUtil.setupConfigurationToggles();

/**
 * Resize the IFrame height, so that it fills the whole available height in the window
 * @param {Boolean} reload Allows reload of the app on resize
 */
function resizeIFrame(reload) {
    var scrollbox = document.getElementById('scrollbox');
    var header = document.getElementById('top');
    var iframe = document.getElementById('articleContent');
    var navbarHeight = document.getElementById('navbar').getBoundingClientRect().height;
    
    // Reset any hidden headers and footers and iframe shift
    header.style.zIndex = 1;
    header.style.transform = 'translateY(0)';
    document.getElementById('footer').style.transform = 'translateY(0)';
    iframe.style.transform = 'translateY(-1px)';
    // iframe.style.height = window.innerHeight + 'px';
    // DEV: if we set the iframe with clientHeight, then it takes into account any zoom
    iframe.style.height = document.documentElement.clientHeight - 5 + 'px';
    // This is needed to cause a reflow in Zimit ZIMs
    setTimeout(function() {
        iframe.style.height = document.documentElement.clientHeight + 'px';
    }, 5);

    //Re-enable top-level scrolling
    scrollbox.style.height = window.innerHeight - navbarHeight + 'px';

    if (iframe.style.display !== "none" && document.getElementById("prefix") !== document.activeElement) {
        scrollbox.style.height = 0;
    }
    var ToCList = document.getElementById('ToCList');
    if (typeof ToCList !== "undefined") {
        ToCList.style.maxHeight = ~~(window.innerHeight * 0.75) + 'px';
        ToCList.style.marginLeft = ~~(window.innerWidth / 2) - ~~(window.innerWidth * 0.16) + 'px';
    }
    if (window.outerWidth <= 470) {
        document.getElementById('dropup').classList.remove('col-xs-4');
        document.getElementById('dropup').classList.add('col-xs-3');
        if (window.outerWidth <= 360) {
            document.getElementById('btnTop').classList.remove('col-xs-2');
            document.getElementById('btnTop').classList.add('col-xs-1');
        } else {
            document.getElementById('btnTop').classList.remove('col-xs-1');
            document.getElementById('btnTop').classList.add('col-xs-2');
        }
    } else {
        document.getElementById('dropup').classList.remove('col-xs-3');
        document.getElementById('dropup').classList.add('col-xs-4');
    }
    if (settingsStore.getItem('reloadDispatched') === 'true') {
        setTimeout(function () {
            settingsStore.removeItem('reloadDispatched');
        }, 1000);
    } else if (reload && params.resetDisplayOnResize) {
        settingsStore.setItem('reloadDispatched', true, Infinity);
        window.location.reload();
        throw 'So long, and thanks for all the fish!';
    }
    removePageMaxWidth();
    checkToolbar();
}

document.onDOMContentLoaded = resizeIFrame;

window.onresize = function () {
    resizeIFrame(true);
    // Check whether fullscreen icon needs to be updated
    setDynamicIcons();
    // We need to load any images exposed by the resize
    var scrollFunc = document.getElementById('articleContent').contentWindow;
    scrollFunc = scrollFunc ? scrollFunc.onscroll : null;
    if (scrollFunc) scrollFunc();
};

// Define behavior of HTML elements

if (params.navButtonsPos === 'top') {
    // User has requested navigation buttons should be at top, so we need to swap them
    var btnBack = document.getElementById('btnBack');
    var btnBackAlt = document.getElementById('btnBackAlt');
    btnBack.id = 'btnBackAlt';
    btnBackAlt.id = 'btnBack';
    btnBackAlt.style.display = 'inline';
    btnBack.style.display = 'none';
    var btnForward = document.getElementById('btnForward');
    var btnForwardAlt = document.getElementById('btnForwardAlt');
    btnForward.id = 'btnForwardAlt';
    btnForwardAlt.id = 'btnForward';
    btnForwardAlt.style.display = 'inline';
    btnForward.style.display = 'none';
    var btnRandom = document.getElementById('btnRandomArticle');
    var btnRandomAlt = document.getElementById('btnRandomArticleAlt');
    btnRandom.id = 'btnRandomArticleAlt';
    btnRandomAlt.id = 'btnRandomArticle';
    btnRandom.style.display = 'none';
    btnRandomAlt.style.display = 'inline';
}

// Process pointerup events (used for checking if mouse back / forward buttons have been clicked)
function onPointerUp(e) {
    if (typeof e === 'object') {
        if (e.button === 3) {
            document.getElementById('btnBack').click();
        }
        if (e.button === 4) {
            document.getElementById('btnForward').click();
        }
    }
}

if (/UWP/.test(params.appType)) document.body.addEventListener('pointerup', onPointerUp);

var searchArticlesFocused = false;
document.getElementById('searchArticles').addEventListener('click', function () {
    var prefix = document.getElementById('prefix').value;
    // Do not initiate the same search if it is already in progress
    if (appstate.search.prefix === prefix && !/^(cancelled|complete)$/.test(appstate.search.status)) return;
    document.getElementById('welcomeText').style.display = 'none';
    $('.alert').hide();
    uiUtil.pollSpinner();
    pushBrowserHistoryState(null, prefix);
    // Initiate the search
    searchDirEntriesFromPrefix(prefix);
    clearFindInArticle();
    //Re-enable top-level scrolling
    document.getElementById('scrollbox').style.height = window.innerHeight - document.getElementById('top').getBoundingClientRect().height + 'px';
    // This flag is set to true in the mousedown event below
    searchArticlesFocused = false;
});
document.getElementById('formArticleSearch').addEventListener('submit', function () {
    document.getElementById('searchArticles').click();
});
// Handle keyboard events in the prefix (article search) field
var keyPressHandled = false;
$('#prefix').on('keydown', function (e) {
// If user presses Escape...
// IE11 returns "Esc" and the other browsers "Escape"; regex below matches both
    if (/^Esc/.test(e.key)) {
        // Hide the article list
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('articleListWithHeader').style.display = 'none';
        document.getElementById('articleContent').focus();
        document.getElementById('mycloseMessage').click(); // This is in case the modal box is showing with an index search
        keyPressHandled = true;
    }
    // Arrow-key selection code adapted from https://stackoverflow.com/a/14747926/9727685
    // IE11 produces "Down" instead of "ArrowDown" and "Up" instead of "ArrowUp"
    if (/^((Arrow)?Down|(Arrow)?Up|Enter)$/.test(e.key)) {
        // User pressed Down arrow or Up arrow or Enter
        e.preventDefault();
        e.stopPropagation();
        // This is needed to prevent processing in the keyup event : https://stackoverflow.com/questions/9951274
        keyPressHandled = true;
        var activeElement = document.querySelector("#articleList .hover") || document.querySelector("#articleList a");
        if (!activeElement) return;
        // If user presses Enter, read the dirEntry
        if (/Enter/.test(e.key)) {
            if (activeElement.classList.contains('hover')) {
                var dirEntryId = activeElement.getAttribute('dirEntryId');
                findDirEntryFromDirEntryIdAndLaunchArticleRead(decodeURIComponent(dirEntryId));
                return;
            }
        }
        // If user presses ArrowDown...
        // (NB selection is limited to five possibilities by regex above)
        if (/Down/.test(e.key)) {
            if (activeElement.classList.contains('hover')) {
                activeElement.classList.remove('hover');
                activeElement = activeElement.nextElementSibling || activeElement;
                var nextElement = activeElement.nextElementSibling || activeElement;
                if (!uiUtil.isElementInView(window, nextElement, true)) nextElement.scrollIntoView(false);
            }
        }
        // If user presses ArrowUp...
        if (/Up/.test(e.key)) {
            activeElement.classList.remove('hover');
            activeElement = activeElement.previousElementSibling || activeElement;
            var previousElement = activeElement.previousElementSibling || activeElement;
            if (!uiUtil.isElementInView(window, previousElement, true)) previousElement.scrollIntoView();
            if (previousElement === activeElement) {
                document.getElementById('articleListWithHeader').scrollIntoView();
                document.getElementById('top').scrollIntoView();
            }
        }
        activeElement.classList.add('hover');
    }
});
// Search for titles as user types characters
$('#prefix').on('keyup', function (e) {
    if (appstate.selectedArchive !== null && appstate.selectedArchive.isReady()) {
        // Prevent processing by keyup event if we already handled the keypress in keydown event
        if (keyPressHandled)
            keyPressHandled = false;
        else
            onKeyUpPrefix(e);
    }
});
// Restore the search results if user goes back into prefix field
$('#prefix').on('focus', function (e) {
    var prefixVal = $('#prefix').val();
    if (/^\s/.test(prefixVal)) {
        // If user had previously had the archive index open, clear it
        document.getElementById('prefix').value = '';
    } else if (prefixVal !== '') {
        document.getElementById('articleListWithHeader').style.display = '';
    }
    document.getElementById('scrollbox').style.position = 'absolute';
    document.getElementById('scrollbox').style.height = window.innerHeight - document.getElementById('top').getBoundingClientRect().height + 'px';
});
// Hide the search results if user moves out of prefix field
document.getElementById('prefix').addEventListener('blur', function () {
    if (!searchArticlesFocused) {
        appstate.search.status = 'cancelled';
    }
    // We need to wait one tick for the activeElement to receive focus
        setTimeout(function () {
            if (!(/^articleList|searchSyntaxLink/.test(document.activeElement.id)
            || /^list-group/.test(document.activeElement.className))) {
                document.getElementById('scrollbox').style.height = 0;
                document.getElementById('articleListWithHeader').style.display = 'none';
                appstate.tempPrefix = '';
                uiUtil.clearSpinner();
            }
        }, 1);
});

//Add keyboard shortcuts
window.addEventListener('keyup', function (e) {
    e = e || window.event;
    //Alt-F for search in article, also patches Ctrl-F for apps that do not have access to browser search
    if ((e.ctrlKey || e.altKey) && e.which == 70) {
        document.getElementById('findText').click();
    }
});

window.addEventListener('keydown', function (e) {
    //Ctrl-P to patch printing support, so iframe gets printed
    if (e.ctrlKey && e.which == 80) {
        e.stopPropagation();
        e.preventDefault();
        printIntercept();
    }
}, true);

//Set up listeners for print dialogues
function printArticle() {    
    uiUtil.printCustomElements();
    uiUtil.systemAlert('<b>Document will now reload to restore the DOM after printing...</b>').then(function () {
        printCleanup();
    });
    //innerDocument.execCommand("print", false, null);
    // if (typeof window.nw !== 'undefined' || typeof window.fs === 'undefined') {
        window.frames[0].frameElement.contentWindow.print();
    // } else {
    //     // We are in an Electron app and need to use export to browser to print
    //     params.preloadingAllImages = false;
    //     // Add a window.print() script to the html
    //     document.getElementById('articleContent').contentDocument.head.innerHTML +=
    //         '\n<script type="text/javascript">window.onload=function() {\n' +
    //         '    alert("After you press OK, you will be asked to choose a printer.\\n" +\n' +
    //         '        "If you want to test the formatting, we suggest you print to\\n" +\n' +
    //         '        "PDF or XPS. You could then open the PDF and select specific pages.");\n' +
    //         '    window.print();\n' +
    //         '};<\/script>';
    //     //html = html.replace(/(<\/head>\s*)/i, '<script type="text/javascript">window.onload=window.print();<\/script>\n$1');
    //     uiUtil.extractHTML();
    // }
};
document.getElementById('printDesktopCheck').addEventListener('click', function (e) {
    //Reload article if user wants to print a different style
    params.cssSource = e.target.checked ? "desktop" : "mobile";
    params.printIntercept = true;
    params.printInterception = false;
    var btnContinue = document.getElementById('printapproveConfirm');
    var btnCancel = document.getElementById('printdeclineConfirm');
    btnCancel.disabled = true;
    btnContinue.disabled = true;
    btnContinue.innerHTML = "Please wait";
    goToArticle(params.lastPageVisit.replace(/@kiwixKey@.+/, ""));
});
document.getElementById('printImageCheck').addEventListener('click', function (e) {
    //Reload article if user wants to print images
    if (e.target.checked && !params.allowHTMLExtraction) {
        params.printIntercept = true;
        params.printInterception = false;
        params.allowHTMLExtraction = true;
        var btnContinue = document.getElementById('printapproveConfirm');
        var btnCancel = document.getElementById('printdeclineConfirm');
        btnCancel.disabled = true;
        btnContinue.disabled = true;
        btnContinue.innerHTML = "Please wait";
        goToArticle(params.lastPageVisit.replace(/@kiwixKey@.+/, ""));
    }
});

function printCleanup() {
    if (!params.printInterception) {
        //We don't need a radical cleanup because there was no printIntercept
        removePageMaxWidth();
        setTab();
        switchCSSTheme();
        return;
    }
    params.printIntercept = false;
    params.printInterception = false;
    // Immediately restore temporarily changed values
    params.allowHTMLExtraction = settingsStore.getItem('allowHTMLExtraction') == "true";
    goToArticle(params.lastPageVisit.replace(/@kiwixKey@.+/, ''));
    setTimeout(function () { //Restore temporarily changed value after page has reloaded
        params.rememberLastPage = settingsStore.getItem('rememberLastPage') === 'true';
        if (!params.rememberLastPage) {
            settingsStore.setItem('lastPageVisit', '', Infinity);
            params.lastPageHTML = '';
            // DEV: replace this with cache.clear when you have repaired that method
            cache.setArticle(params.lastPageVisit.replace(/.+@kiwixKey@/, ''), params.lastPageVisit.replace(/@kiwixKey@.+/, ''), '', function(){});
        }
    }, 5000);
}
//End of listeners for print dialogues

function printIntercept() {
    params.printInterception = params.printIntercept;
    params.printIntercept = false;
    document.getElementById('btnAbout').classList.add('active');
    var btnContinue = document.getElementById('printapproveConfirm');
    var btnCancel = document.getElementById('printdeclineConfirm');
    btnCancel.disabled = false;
    btnContinue.disabled = false;
    btnContinue.innerHTML = "Continue";
    var printModalContent = document.getElementById('print-modal-content');
    openAllSections(true);
    printModalContent.classList.remove('dark');
    var determinedTheme = params.cssUITheme;
    determinedTheme = determinedTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : determinedTheme;
    if (determinedTheme != "light") {
        printModalContent.classList.add('dark');
    }
    //If document is in wrong style, or images are one-time BLOBs, reload it
    //var innerDoc = window.frames[0].frameElement.contentDocument;
    var innerDoc = document.getElementById('articleContent').contentDocument;
    var printDesktopCheck = document.getElementById("printDesktopCheck").checked;
    var printImageCheck = document.getElementById("printImageCheck").checked;
    var styleIsDesktop = !/href\s*=\s*["'][^"']*?(?:minerva|mobile)/i.test(innerDoc.head.innerHTML);
    //if (styleIsDesktop != printDesktopCheck || printImageCheck && !params.allowHTMLExtraction || params.contentInjectionMode == 'serviceworker') {
    if (styleIsDesktop != printDesktopCheck || printImageCheck && !params.allowHTMLExtraction) {
        //We need to reload the document because it doesn't match the requested style or images are one-time BLOBs
        params.cssSource = printDesktopCheck ? "desktop" : "mobile";
        params.rememberLastPage = true; //Re-enable caching to speed up reloading of page
        //params.contentInjectionMode = 'jquery'; //Much easier to count images in jquery mode 
        params.allowHTMLExtraction = true;
        params.printIntercept = true;
        params.printInterception = false;
        btnCancel.disabled = true;
        btnContinue.disabled = true;
        btnContinue.innerHTML = "Please wait";
        // Show the modal so the user knows that printing is being prepared
        document.getElementById('printModal').style.display = 'block';
        goToArticle(params.lastPageVisit.replace(/@kiwixKey@.+/, ""));
        return;
    }
    //Pre-load all images in case user wants to print them
    if (params.imageDisplay) {
        document.getElementById("printImageCheck").disabled = false;
        if (printImageCheck) {
            btnCancel.disabled = true;
            btnContinue.disabled = true;
            btnContinue.innerHTML = "Loading images...";
            //Callback for when all images are loaded
            params.printImagesLoaded = function () {
                // Images have finished loading, so enable buttons
                btnCancel.disabled = false;
                btnContinue.disabled = false;
                btnContinue.innerHTML = "Continue";
            };
            if (params.contentInjectionMode == 'jquery') {
                images.prepareImagesJQuery(articleWindow, true);
            } else {
                images.prepareImagesServiceWorker(articleWindow, true);
            }
        }
    } else {
        document.getElementById("printImageCheck").checked = false;
        document.getElementById("printImageCheck").disabled = true;
    }
    //Remove max page-width restriction
    if (params.removePageMaxWidth !== true) {
        var tempPageMaxWidth = params.removePageMaxWidth;
        params.removePageMaxWidth = true;
        removePageMaxWidth();
        params.removePageMaxWidth = tempPageMaxWidth;
    }
    //Put doc into light mode
    params.cssTheme = 'light';
    switchCSSTheme();
    uiUtil.systemAlert(' ', '', true, null, 'Continue', null, 'printModal').then(function (result) {
        //Restore temporarily changed values
        params.cssSource = settingsStore.getItem('cssSource') || "auto";
        params.cssTheme = settingsStore.getItem('cssTheme') || "light";
        if (result) printArticle();
        else printCleanup();
    });
}

//Establish some variables with global scope
var localSearch = {};


function clearFindInArticle() {
    if (document.getElementById('row2').style.display === "none") return;
    if (typeof localSearch !== "undefined" && localSearch.remove) {
        localSearch.remove();
    }
    document.getElementById('findInArticle').value = "";
    document.getElementById('matches').innerHTML = "Full: 0";
    document.getElementById('partial').innerHTML = "Partial: 0";
    document.getElementById('row2').style.display = "none";
    document.getElementById('findText').classList.remove("active");
}

document.getElementById('findText').addEventListener('click', function () {
    var searchDiv = document.getElementById('row2');
    if (searchDiv.style.display !== "none") {
        setTab();
        // Return params.hideToolbars to its original state
        checkToolbar();
        return;
    }
    var findInArticle = null;
    var innerDocument = window.frames[0].frameElement.contentDocument;
    innerDocument = innerDocument ? innerDocument.body : null;
    if (!innerDocument || innerDocument.innerHTML.length < 10) return;
    setTab('findText');
    findInArticle = document.getElementById('findInArticle');
    searchDiv.style.display = "block";
    // Show the toolbar
    params.hideToolbars = false;
    checkToolbar();
    findInArticle.focus();
    localSearch = new util.Hilitor(innerDocument);
    //TODO: MatchType should be language specific
    var timer = null;
    findInArticle.addEventListener('keyup', function (e) {
        //If user pressed Alt-F or Ctrl-F, exit
        if ((e.altKey || e.ctrlKey) && e.which == 70) return;
        var val = this.value;
        //If user pressed enter / return key
        if (val && e.which == 13) {
            localSearch.scrollFrom = localSearch.scrollToFullMatch(val, localSearch.scrollFrom);
            return;
        }
        //If value hasn't changed, exit
        if (val == localSearch.lastScrollValue) return;
        findInArticleKeyup(val);
    });
    var findInArticleKeyup = function (val) {
        // Use a timeout, so that very quick typing does not cause a lot of overhead
        if (window.timeoutFIAKeyup) {
            window.clearTimeout(window.timeoutFIAKeyup);
        }
        window.timeoutFIAKeyup = window.setTimeout(function () {
            findInArticleInitiate(val);
        }, 500);
    };
    var findInArticleInitiate = function (val) {
        //Ensure nothing happens if only one or two ASCII values have been entered (search is not specific enough) 
        //if no value has been entered (clears highlighting if user deletes all values in search field)
        if (!/^\s*[A-Za-z\s]{1,2}$/.test(val)) {
            localSearch.scrollFrom = 0;
            localSearch.lastScrollValue = val;
            localSearch.setMatchType('open');
            //Change matchType to 'left' if we are dealing with an ASCII language and a space has been typed
            if (/\s/.test(val) && /(?:^|[\s\b])[A-Za-z]+(?:[\b\s]|$)/.test(val)) localSearch.setMatchType('left');
            localSearch.apply(val);
            if (val.length) {
                var fullTotal = localSearch.countFullMatches(val);
                var partialTotal = localSearch.countPartialMatches();
                fullTotal = fullTotal > partialTotal ? partialTotal : fullTotal;
                document.getElementById('matches').innerHTML = '<a id="scrollLink" href="#">Full: ' + fullTotal + '</a>';
                document.getElementById('partial').innerHTML = "Partial: " + partialTotal;
                document.getElementById('scrollLink').addEventListener('click', function () {
                    localSearch.scrollFrom = localSearch.scrollToFullMatch(val, localSearch.scrollFrom);
                });
                //Auto-scroll: TODO - consider making this an option
                localSearch.scrollFrom = localSearch.scrollToFullMatch(val, localSearch.scrollFrom);
            } else {
                document.getElementById('matches').innerHTML = "Full: 0";
                document.getElementById('partial').innerHTML = "Partial: 0";
            }
        }
    };
});

document.getElementById('btnRandomArticle').addEventListener('click', function () {
    // In jQuery mode, only load random content in iframe (not tab or window)
    appstate.target = 'iframe';
    setTab('btnRandomArticle');
    //Re-enable top-level scrolling
    goToRandomArticle();
});

document.getElementById('btnRescanDeviceStorage').addEventListener("click", function () {
    var returnDivs = document.getElementsByClassName("returntoArticle");
    for (var i = 0; i < returnDivs.length; i++) {
        returnDivs[i].innerHTML = "";
    }
    params.rescan = true;
    //Reload any ZIM files in local storage (which the usar can't otherwise select with the filepicker)
    loadPackagedArchive();
    if (storages.length) {
        searchForArchivesInStorage();
    } else {
        displayFileSelect();
    }
    document.getElementById('rescanStorage').style.display = 'none';
});
// Bottom bar :
// @TODO Since bottom bar now hidden in Settings and About the returntoArticle code cannot be accessed;
// consider adding it to top home button instead
document.getElementById('btnBack').addEventListener('click', function () {
    if (document.getElementById('articleContent').style.display == "none") {
        document.getElementById('returntoArticle').click();
        return;
    }
    clearFindInArticle();
    history.back();
    return;
});
document.getElementById('btnForward').addEventListener('click', function () {
    clearFindInArticle();
    history.forward();
});
document.getElementById('btnZoomin').addEventListener('click', function () {
    params.relativeFontSize += 5;
    var doc = document.getElementById('articleContent').contentDocument;
    var docElStyle = doc.documentElement.style;
    // IE11 and Firefox need to use fontSize on the body style
    var zoomProp = '-ms-zoom' in docElStyle ? 'fontSize' : 'zoom' in docElStyle ? 'zoom' : 'fontSize'; 
    docElStyle = zoomProp === 'fontSize' ? doc.body.style : docElStyle; 
    docElStyle[zoomProp] = /-\/static\/main\.css|statc\/css\/sotoki.css/.test(doc.head.innerHTML) && zoomProp === 'fontSize' ? params.relativeFontSize * 1.5 + "%" : params.relativeFontSize + "%";
    var lblZoom = document.getElementById('lblZoom');
    lblZoom.innerHTML = params.relativeFontSize + "%";
    lblZoom.style.cssText = "position:absolute;right:" + window.innerWidth / 5 + "px;bottom:50px;z-index:50;";
    setTimeout(function () {
        lblZoom.innerHTML = "";
    }, 2000);
    settingsStore.setItem('relativeFontSize', params.relativeFontSize, Infinity);
    document.getElementById('articleContent').contentWindow.focus();
});
document.getElementById('btnZoomout').addEventListener('click', function () {
    params.relativeFontSize -= 5;
    var doc = document.getElementById('articleContent').contentDocument;
    var docElStyle = doc.documentElement.style;
    var zoomProp = '-ms-zoom' in docElStyle ? 'fontSize' : 'zoom' in docElStyle ? 'zoom' : 'fontSize'; 
    docElStyle = zoomProp === 'fontSize' ? doc.body.style : docElStyle; 
    docElStyle[zoomProp] = /-\/static\/main\.css|statc\/css\/sotoki.css/.test(doc.head.innerHTML) && zoomProp === 'fontSize' ? params.relativeFontSize * 1.5 + "%" : params.relativeFontSize + "%";
    var lblZoom = document.getElementById('lblZoom');
    lblZoom.innerHTML = params.relativeFontSize + "%";
    lblZoom.style.cssText = "position:absolute;right:" + window.innerWidth / 4 + "px;bottom:50px;z-index:50;";
    setTimeout(function () {
        lblZoom.innerHTML = "";
    }, 2000);
    settingsStore.setItem('relativeFontSize', params.relativeFontSize, Infinity);
    document.getElementById('articleContent').contentWindow.focus();
});
setRelativeUIFontSize(params.relativeUIFontSize);
document.getElementById('relativeUIFontSizeSlider').addEventListener('change', function () {
    setRelativeUIFontSize(this.value);
});

function setRelativeUIFontSize(value) {
    value = ~~value;
    document.getElementById('spinnerVal').innerHTML = value + "%";
    document.getElementById('search-article').style.fontSize = value + "%";
    document.getElementById('relativeUIFontSizeSlider').value = value;
    var forms = document.querySelectorAll('.form-control');
    var i;
    for (i = 0; i < forms.length; i++) {
        forms[i].style.fontSize = ~~(value * 14 / 100) + "px";
    }
    var buttons = document.getElementsByClassName('btn');
    for (i = 0; i < buttons.length; i++) {
        // Some specific buttons need to be smaller
        buttons[i].style.fontSize = /Archive|RefreshApp|Reset2/.test(buttons[i].id) ? ~~(value * 10 / 100) + "px" : ~~(value * 14 / 100) + "px";
    }
    var heads = document.querySelectorAll("h1, h2, h3, h4");
    for (i = 0; i < heads.length; i++) {
        var multiplier = 1;
        var head = heads[i].tagName;
        multiplier = head == "H4" ? 1.4 : head == "H3" ? 1.9 : head == "H2" ? 2.3 : head == "H1" ? 2.8 : multiplier;
        heads[i].style.fontSize = ~~(value * 0.14 * multiplier) + "px";
    }
    document.getElementById('displaySettingsDiv').scrollIntoView();
    //document.getElementById('prefix').style.height = ~~(value * 14 / 100) * 1.4285 + 14 + "px";
    if (value != params.relativeUIFontSize) {
        params.relativeUIFontSize = value;
        settingsStore.setItem('relativeUIFontSize', value, Infinity);
    }
}

document.getElementById('btnHomeBottom').addEventListener('click', function () {
    document.getElementById('btnHome').click();
});

// Deal with the Windows Mobile / Tablet back button
if (typeof Windows !== 'undefined' &&
    typeof Windows.UI !== 'undefined' &&
    typeof Windows.ApplicationModel !== 'undefined') {
    var onBackRequested = function (eventArgs) {
        window.history.back();
        eventArgs.handled = true;
    }
    Windows.UI.Core.SystemNavigationManager.getForCurrentView().
        appViewBackButtonVisibility =
        Windows.UI.Core.AppViewBackButtonVisibility.visible;
    Windows.UI.Core.SystemNavigationManager.getForCurrentView().
        addEventListener("backrequested", onBackRequested);
}

document.getElementById('btnTop').addEventListener('click', function () {
    var header = document.getElementById('top');
    var iframe = document.getElementById('articleContent');
    // If the toolbar is hidden, show it instead of jumping to top
    if (!/\(0p?x?\)/.test(header.style.transform)) {
        header.style.transform = 'translateY(0)';
    } else {
        if (!params.hideToolbars) iframe.style.transform = 'translateY(-1px)';
        iframe.contentWindow.scrollTo({
            top: '0',
            behavior: 'smooth'
        });
        document.getElementById('search-article').scrollTop = 0;
    }
    iframe.contentWindow.focus();
});
// Top menu :
document.getElementById('btnHome').addEventListener('click', function () {
    // In jQuery mode, only load landing page in iframe (not tab or window)
    appstate.target = 'iframe';
    setTab('btnHome');
    document.getElementById('search-article').scrollTop = 0;
    let articleContent = document.getElementById('articleContent');
    let articleContentDoc = articleContent ? articleContent.contentDocument : null;
    while (articleContentDoc.firstChild) articleContentDoc.removeChild(articleContentDoc.firstChild);
    uiUtil.clearSpinner();
    document.getElementById('welcomeText').style.display = '';
    if (appstate.selectedArchive !== null && appstate.selectedArchive.isReady()) {
        document.getElementById('welcomeText').style.display = 'none';
        goToMainArticle();
    }
});

var currentArchive = document.getElementById('currentArchive');
var currentArchiveLink = document.getElementById('currentArchiveLink');
var openCurrentArchive = document.getElementById('openCurrentArchive');

function setTab(activeBtn) {
    // Highlight the selected section in the navbar
    setActiveBtn(activeBtn);
    clearFindInArticle();
    //Re-enable bottom toolbar display
    document.getElementById('footer').style.display = "block";
    //Re-enable top-level scrolling
    document.getElementById('top').style.position = "relative";
    //Use the "light" navbar if the content is "light" (otherwise it looks shite....)
    var determinedTheme = cssUIThemeGetOrSet(params.cssUITheme);
    var determinedWikiTheme = params.cssTheme == 'auto' ? determinedTheme : params.cssTheme == 'inverted' ? 'dark' : params.cssTheme;
    if (determinedWikiTheme != determinedTheme) {
        if (determinedWikiTheme == "light" && (!activeBtn || activeBtn == "btnHome" || activeBtn == "findText") ||
            determinedWikiTheme == "dark" && activeBtn && activeBtn != "btnHome" && activeBtn != "findText") {
            cssUIThemeGetOrSet("light");
        } else {
            cssUIThemeGetOrSet("dark");
        }
    } else {
        cssUIThemeGetOrSet(determinedTheme);
    }
    if (typeof Windows === 'undefined' && typeof window.showOpenFilePicker !== 'function' && !window.dialog) {
        //If not UWP, File System Access API, or Electron methods, display legacy File Select
        document.getElementById('archiveFilesDiv').style.display = 'none';
        document.getElementById('archivesFound').style.display = 'none';
        document.getElementById('instructions').style.display = appstate.selectedArchive ? 'none' : 'block';
        document.getElementById('archiveFilesLegacyDiv').style.display = 'block';
        document.getElementById('btnRefresh').style.display = 'none';
    } else {
        document.getElementById('archiveFilesLegacyDiv').style.display = 'none';
        // Remove instructions if user has already loaded an archive, and it isn't the packaged archive
        document.getElementById('UWPInstructions').style.display = appstate.selectedArchive && ~params.packagedFile.indexOf(appstate.selectedArchive._file.name) ? 'none' : 'block';
    }
    document.getElementById('chooseArchiveFromLocalStorage').style.display = "block";
    document.getElementById('libraryArea').style.borderColor = '';
    document.getElementById('libraryArea').style.borderStyle = '';
    if (params.packagedFile && params.storedFile && params.storedFile !== params.packagedFile) {
        currentArchiveLink.innerHTML = params.storedFile.replace(/\.zim$/i, '');
        currentArchive.style.display = "block";
        document.getElementById('downloadLinksText').style.display = "none";
        document.getElementById('usage').style.display = "none";
    }
    if (params.storedFile && params.storedFile == params.packagedFile) {
        if (/wikipedia.en.(100|ray.charles)/i.test(params.packagedFile)) document.getElementById('usage').style.display = 'inline';
        document.getElementById('downloadLinksText').style.display = 'block';
        currentArchive.style.display = 'none';
    }
    var update = document.getElementById('update');
    if (update) document.getElementById('logUpdate').innerHTML = update.innerHTML.match(/<ul[^>]*>[\s\S]+/i);
    var features = document.getElementById('features');
    if (features) document.getElementById('logFeatures').innerHTML = features.innerHTML;
    // Show the selected content in the page
    document.getElementById('about').style.display = 'none';
    document.getElementById('configuration').style.display = 'none';
    document.getElementById('formArticleSearch').style.display = '';
    if (!activeBtn || activeBtn == 'btnHome') {
        // document.getElementById('search-article').scrollTop = 0;
        document.getElementById('scrollbox').style.height = 0;
        document.getElementById('search-article').style.overflowY = 'hidden';
        setTimeout(function() {
            if (appstate.target === 'iframe') {
                if (articleContainer && articleContainer.style) articleContainer.style.display = 'block';
                if (articleWindow) articleWindow.focus();
            }
        }, 50);
    }
    setDynamicIcons(activeBtn);
    let articleList = document.getElementById('articleList');
    let articleListHeaderMessage =  document.getElementById('articleListHeaderMessage');
    while (articleList.firstChild) articleList.removeChild(articleList.firstChild);
    while (articleListHeaderMessage.firstChild) articleListHeaderMessage.removeChild(articleListHeaderMessage.firstChild);
    document.getElementById('articleListWithHeader').style.display = 'none';
    $("#prefix").val("");
    document.getElementById('welcomeText').style.display = 'none';
    if (params.beforeinstallpromptFired) {
        var divInstall1 = document.getElementById('divInstall1');
        if (activeBtn !== 'btnConfigure' && !params.installLater && (params.pagesLoaded === 3 || params.pagesLoaded === 9)) {
            divInstall1.style.display = 'block';
            setTimeout(function() {
                // If installLater is now true, then the user clicked the Later button and the timeout in init.js will hide the display
                if (!params.installLater) {
                    divInstall1.style.display = 'none';
                    resizeIFrame();
                }
            }, 9000);
        } else {
            divInstall1.style.display = 'none';
        }
    }
    // Check for upgrade of PWA
    if (activeBtn === 'btnConfigure') checkPWAUpdate();
    // Resize iframe
    setTimeout(resizeIFrame, 100);
}

// Set the dynamic icons in the navbar
function setDynamicIcons(btn) {
    var btnAbout = document.getElementById('btnAbout');
    if (params.lockDisplayOrientation) {
        if (uiUtil.appIsFullScreen()) {
            btnAbout.innerHTML = '<span class="glyphicon glyphicon-resize-small"></span>';
            btnAbout.title = 'Exit fullscreen';
        } else {
            btnAbout.innerHTML = '<span class="glyphicon glyphicon-fullscreen"></span>';
            btnAbout.title = 'Return to fullscreen';
        }
    } else {
        // When the scrollbox height is 0, we are not in Configuration or About
        if (!btn && document.getElementById('scrollbox').offsetHeight === 0 || btn == "btnHome" || btn == "findText") {
            btnAbout.innerHTML = '<span class="glyphicon glyphicon-print"></span>';
            btnAbout.title = 'Ctrl-P: Print';
        } else {
            btnAbout.innerHTML = '<span class="glyphicon glyphicon-info-sign"></span>';
            btnAbout.title = 'About';
        }
    }
}

// Check if a PWA update is available
function checkPWAUpdate() {
    if (!params.upgradeNeeded && /^(?:HTML5|UWP).*PWA/.test(params.appType)) {
        caches.keys().then(function (keyList) {
            var cachePrefix = cache.APPCACHE.replace(/^([^\d]+).+/, '$1');
            document.getElementById('alertBoxPersistent').innerHTML = '';
            keyList.forEach(function(key) {
                if (key === cache.APPCACHE || key === cache.CACHEAPI) return;
                // Ignore any keys that do not begin with the APPCACHE prefix (they could be from other apps using the same domain)
                if (key.indexOf(cachePrefix)) return;
                // If we get here, then there is a kiwix cache key that does not match our version, i.e. a PWA-in-waiting
                var version = key.replace(cachePrefix, '');
                var loadOrInstall = params.PWAInstalled ? 'install' : 'load';
                params.upgradeNeeded = true;
                uiUtil.showUpgradeReady(version, loadOrInstall);
            });
        });
    } else if (params.upgradeNeeded) {
        var upgradeAlert = document.getElementById('upgradeAlert');
        if (upgradeAlert) upgradeAlert.style.display = 'block';
    }
}

// Electron callback listener if an update is found by main.js
if (window.electronAPI) {
    electronAPI.on('update-available', function (data) {
        console.log('Upgrade is available:' + data);
        params.upgradeNeeded = true;
        uiUtil.showUpgradeReady(data.version, 'install');
    });
    var serverResponse = document.getElementById('serverResponse');
    electronAPI.on('dl-received', function (data) {
        // console.warn('Download in progress: ' + data);
        serverResponse.style.display = 'inline';
        var colour = data === 'completed' ? 'green' : isNaN(data) ? 'red' : 'goldenrod';
        serverResponse.style.setProperty('color', colour, 'important'); 
        serverResponse.innerHTML = 'Download progress: ' + data;
        if (data === 'completed') setTimeout(function () {
            serverResponse.style.removeProperty('color');
            if (document.getElementById('downloadLinks').style.display === 'none') {
                serverResponse.style.display = 'none';
            }
        }, 10000);
    });
}

// Check for GitHub and Electron updates
var updateCheck = document.getElementById('updateCheck');
params.isUWPStoreApp = /UWP/.test(params.appType) && Windows.ApplicationModel && Windows.ApplicationModel.Package &&
    !/Association.Kiwix/.test(Windows.ApplicationModel.Package.current.id.publisher) || electronAPI && electronAPI.isMicrosotStoreApp;
// If Internet access is allowed, or it's a UWP Store app, or it's HTML5 (i.e., not Electron/NWJS or UWP) ...
if (params.allowInternetAccess || params.isUWPStoreApp || /HTML5/.test(params.appType)) {
    updateCheck.style.display = 'none'; // ... hide the update check link
    if (params.isUWPStoreApp) console.debug('Hiding update check link because this is a UWP Store app.');
}
// Function to check for updates from GitHub
function checkUpdateServer() {
    if (!params.allowInternetAccess || params.upgradeNeeded) {
        console.warn('The GitHub update check was blocked because ' + (params.upgradeNeeded ? 'a PWA upgrade is needed.' : 'the user has not allowed Internet access.'));
        return;
    }
    // If it's plain HTML5 (not Electron/NWJS or UWP), don't check for updates
    if (/HTML5/.test(params.appType)) return;
    if (params.isUWPStoreApp) return; // It's a UWP app installed from the Store, so it will self update
    // GitHub updates
    console.log('Checking for updates from Releases...');
    updater.getLatestUpdates(function (tag, url, releases) {
        var updateSpan = document.getElementById('updateStatus');
        if (!tag) {
            var upToDate = '[&nbsp;<b><i>Latest&nbsp;version</i></b>&nbsp;]';
            updateCheck.style.display = 'inline';
            updateCheck.innerHTML = upToDate;
            updateSpan.innerHTML = upToDate;
            console.log('No new update was found.');
            return;
        }
        console.log('We found this update: [' + tag + '] ' + url, releases);
        updateSpan.innerHTML = '[ <b><i><a href="#alertBoxPersistent">New update!</a></i></b> ]';
        params.upgradeNeeded = true;
        uiUtil.showUpgradeReady(tag.replace(/^v/, ''), 'download', url);
    });
    // Electron updates
    if (window.electronAPI) {
        var baseApp = (params.packagedFile && /wikivoyage/.test(params.packagedFile)) ? 'wikivoyage' :
            (params.packagedFile && /wikmed|mdwiki/.test(params.packagedFile)) ? 'wikimed' :
            'electron';
        if (baseApp === 'electron') {
            console.log('Launching Electron auto-updater...');
            electronAPI.checkForUpdates();
        } else {
            console.log('Auto-update: Packaged apps with large ZIM archives are not currently auto-updated.');
        }
    }
}

// Do update checks 10s after startup
setTimeout(function () {
    if (/^(?:HTML5|UWP).*PWA/.test(params.appType)) {
        console.log('Checking for updates to the PWA...');
        checkPWAUpdate();
    }
    checkUpdateServer();
}, 10000);

function setActiveBtn(activeBtn) {
    document.getElementById('btnHome').classList.remove("active");
    document.getElementById('btnRandomArticle').classList.remove("active");
    document.getElementById('btnConfigure').classList.remove("active");
    document.getElementById('btnAbout').classList.remove("active");
    if (activeBtn) {
        var activeID = document.getElementById(activeBtn);
        if (activeID) activeID.classList.add("active");
    }
}

document.getElementById('btnConfigure').addEventListener('click', function () {
    var searchDiv = document.getElementById('configuration');
    if (searchDiv.style.display !== 'none') {
        setTab();
        if (params.themeChanged) {
            params.themeChanged = false;
            var archiveName = appstate.selectedArchive ? appstate.selectedArchive._file.name : null;
            if (archiveName && ~params.lastPageVisit.indexOf(archiveName)) {
                goToArticle(params.lastPageVisit.replace(/@kiwixKey@.+$/, ''));
            }
            //if (history.state !== null) {
            //    var thisURL = decodeURIComponent(history.state.title);
            //    goToArticle(thisURL);
            //}
        }
        return;
    }
    $('.alert').hide();
    // Highlight the selected section in the navbar
    setTab('btnConfigure');
    //Hide footer toolbar
    document.getElementById('footer').style.display = "none";
    // Show the selected content in the page
    document.getElementById('configuration').style.display = '';
    document.getElementById('articleContent').style.display = 'none';
    document.getElementById('downloadLinks').style.display = 'none';
    document.getElementById('serverResponse').style.display = 'none';
    document.getElementById('myModal').style.display = 'none';
    refreshAPIStatus();
    //Re-enable top-level scrolling
    document.getElementById('scrollbox').style.height = window.innerHeight - document.getElementById('top').getBoundingClientRect().height + 'px';
    document.getElementById('search-article').style.overflowY = "auto";
    //If user hadn't previously picked a folder or a file, resort to the local storage folder (UWP functionality)
    if (params.localStorage && !params.pickedFolder && !params.pickedFile) {
        params.pickedFolder = params.localStorage;
    }
    // If user had previously picked a file using Native FS, offer to re-open
    if (typeof window.showOpenFilePicker === 'function' && !(params.pickedFile || params.pickedFolder)) {
        getNativeFSHandle();
    }
});

function getNativeFSHandle(callback) {
    cache.idxDB('pickedFSHandle', function(val) {
        if (val) {
            var handle = val;
            return cache.verifyPermission(handle, false).then(function (accessible) {
                if (accessible) {
                    openCurrentArchive.style.display = 'none';
                    if (callback) {
                        callback(handle);
                        return;
                    }
                    if (handle.kind === 'file') {
                        return processNativeFileHandle(handle);
                    } else if (handle.kind === 'directory') {
                        return processNativeDirHandle(handle);
                    }
                } else {
                    openCurrentArchive.style.display = 'inline';
                    if (callback) {
                        callback(handle);
                    } else {
                        searchForArchivesInPreferencesOrStorage();
                    }
                }
            });
        } else {
            if (callback) {
                callback(null);
            } else {
                // We have failed to load a picked archive via the File System API, but if params.storedFilePath exists, then the archive
                // was launched with Electron APIs, so we can get the folder that way
                if (params.storedFilePath) params.pickedFolder = params.storedFilePath.replace(/[\\/]+[^\\/]+$/, '');
                searchForArchivesInPreferencesOrStorage();
            }
        }
    });
}

document.getElementById('btnAbout').addEventListener('click', function () {
    var btnAboutElement = document.getElementById('btnAbout');
    // Don't allow this button to be clicked if button is being used as exit fullscreen button
    if (/glyphicon-(fullscreen|resize-small)/.test(btnAboutElement.innerHTML)) return;
    // Deal with use of button for printing
    if (/glyphicon-print/.test(btnAboutElement.innerHTML)) {
        printIntercept();
        return;
    }
    //Check if we're 'unclicking' the button
    var searchDiv = document.getElementById('about');
    if (searchDiv.style.display != 'none') {
        setTab();
        return;
    }
    // Highlight the selected section in the navbar
    setTab('btnAbout');
    //Hide footer toolbar
    document.getElementById('footer').style.display = "none";
    // Show the selected content in the page
    document.getElementById('about').style.display = '';
    document.getElementById('articleContent').style.display = 'none';
    $('.alert').hide();
    //Re-enable top-level scrolling
    document.getElementById('scrollbox').style.height = window.innerHeight - document.getElementById('top').getBoundingClientRect().height + 'px';
    document.getElementById('search-article').style.overflowY = "auto";
});
var selectFired = false;
document.getElementById('archiveList').addEventListener('keydown', function(e) {
    if (/^Enter$/.test(e.key)) {
        selectArchive(e);
    }
});
document.getElementById('archiveList').addEventListener('click', selectArchive);
currentArchiveLink.addEventListener('click', function (e) {
    e.target.value = currentArchiveLink.innerHTML;
    selectArchive(e);
});
openCurrentArchive.addEventListener('click', function (e) {
    e.target.value = currentArchiveLink.innerHTML;
    selectArchive(e);
});

function selectArchive(list) {
    if (selectFired) return;
    // If nothing was selected, user will have to click again
    if (!list.target.value) return;
    selectFired = true;
    var selected = list.target.value;
    // Void any previous picked file to prevent it launching
    if (params.pickedFile && params.pickedFile.name !== selected) {
        params.pickedFile = '';
    }
    if (!window.fs && window.showOpenFilePicker) {
        getNativeFSHandle(function(handle) {
            if (!handle) {
                console.error('No handle was retrieved');
                uiUtil.systemAlert('We could not get a handle to the previously picked file or folder!<br>' +
                    'This is probably because the contents of the folder have changed. Please try picking it again.');
                document.getElementById('openLocalFiles').style.display = 'block';
                document.getElementById('rescanStorage').style.display = 'none';
                return;
            }
            if (handle.kind === 'directory') {
                params.pickedFolder = handle;
                setLocalArchiveFromArchiveList(selected);
            } else if (handle.kind === 'file') {
                handle.getFile().then(function(file) {
                    params.pickedFile = file;
                    params.pickedFile.handle = handle;
                    setLocalArchiveFromArchiveList(selected);
                }).catch(function(err) {
                    console.error('Unable to read previously picked file!', err);
                    uiUtil.systemAlert('We could not retrieve the previously picked file or folder!<br>Please try picking it again.');
                    document.getElementById('openLocalFiles').style.display = 'block';
                    document.getElementById('rescanStorage').style.display = 'none';
                });
            }
        });
    } else {
        setLocalArchiveFromArchiveList([selected]);
    }
    setTimeout(function () {
        document.getElementById('openLocalFiles').style.display = 'none';
        document.getElementById('rescanStorage').style.display = 'block';
        document.getElementById('usage').style.display = 'none';
        selectFired = false;
    }, 0);
}

// Legacy file picker is used as a fallback when all other pickers are unavailable
document.getElementById('archiveFilesLegacy').addEventListener('change', setLocalArchiveFromFileSelect);
// But in preference, use UWP, File System Access API        
document.getElementById('archiveFile').addEventListener('click', function () {
    if (typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined') {
        //UWP FilePicker
        pickFileUWP();
    } else if (typeof window.showOpenFilePicker === 'function') {
        // File System Access API file picker
        pickFileNativeFS();
    } else if (window.fs && window.dialog) {
        // Electron file picker if showOpenFilePicker is not available
        dialog.openFile();
    }
});
document.getElementById('archiveFiles').addEventListener('click', function () {
    if (typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined') {
        //UWP FolderPicker
        pickFolderUWP();
    } else if (typeof window.showOpenFilePicker === 'function') {
        // Native File System API folder picker
        pickFolderNativeFS();
    } else if (window.fs && window.dialog) {
        // Electron fallback
        dialog.openDirectory();
}
});
document.getElementById('btnRefresh').addEventListener('click', function () {
    // Refresh list of archives
    if (params.pickedFolder) {
        params.rescan = true;
        if (window.showOpenFilePicker) {
            processNativeDirHandle(params.pickedFolder);
        } else if (typeof Windows !== 'undefined') {
            scanUWPFolderforArchives(params.pickedFolder)
        } else if (window.fs) {
            scanNodeFolderforArchives(params.pickedFolder);
        }
    } else if (typeof window.showOpenFilePicker === 'function' && !params.pickedFile) {
        getNativeFSHandle(function (fsHandle) {
            if (fsHandle && fsHandle.kind === 'directory') {
                processNativeDirHandle(fsHandle);
            } else {
                uiUtil.systemAlert('You need to pick a folder in order to rescan it!');        
            }
        });
    } else {
        uiUtil.systemAlert('You need to pick a folder in order to rescan it!');
    }
});
document.getElementById('downloadTrigger').addEventListener('click', function () {
    kiwixServe.requestXhttpData(params.kiwixDownloadLink);
});

$('input:radio[name=contentInjectionMode]').on('change', function () {
    if (this.value === 'jquery' && !params.appCache) {
        uiUtil.systemAlert('You must deselect the "Bypass AppCache" option before switching to JQuery mode!');
        this.checked = false;
        document.getElementById('serviceworkerModeRadio').checked = true;
        return;
    }
    var returnDivs = document.getElementsByClassName("returntoArticle");
    for (var i = 0; i < returnDivs.length; i++) {
        returnDivs[i].innerHTML = "";
    }
    // Do the necessary to enable or disable the Service Worker
    setContentInjectionMode(this.value);
    // If we're in a PWA UWP app, warn the user that this does not disable the PWA
    if (this.value === 'jquery' && /^http/i.test(window.location.protocol) && /UWP\|PWA/.test(params.appType) &&
        params.allowInternetAccess === 'true') {
        uiUtil.systemAlert(
            '<p>Please note that switching content injection mode does not revert to local code.</p>' +
            '<p>If you wish to exit the PWA, you will need to turn off "Allow Internet access?" above.</p>'
        );
    }
    if (this.value === 'serviceworker') {
        if (params.manipulateImages || params.allowHTMLExtraction) {
            if (!appstate.wikimediaZimLoaded) {
                var message = 'Please note that we are disabling "Image manipulation" and/or "Download or open current article" features, as these options ' +
                'can interfere with ZIMs that have active content. You may turn them back on, but be aware that they are only ' + 
                'recommended for use with Wikimedia ZIMs.';
                uiUtil.systemAlert(message);
                if (params.manipulateImages) document.getElementById('manipulateImagesCheck').click();
                if (params.allowHTMLExtraction) document.getElementById('allowHTMLExtractionCheck').click();
            }
        }
    }
    params.themeChanged = true; // This will reload the page
});
$('input:checkbox[name=allowInternetAccess]').on('change', function () {
    document.getElementById('serverResponse').style.display = "none";
    params.allowInternetAccess = this.checked;
    if (!this.checked) {
        document.getElementById('downloadLinks').style.display = "none";
        if (/^http/i.test(window.location.protocol)) {
            var message;
            if (!/PWA/.test(params.appType)) {
                message = '<p>You are accessing Kiwix JS from a remote server, and it is not possible to disable Internet access fully without exiting the app.</p>' +
                    '<p>Please visit <a href="https://kiwix.github.io/kiwix-js-windows/kiwix-js-electron.html" target="_blank">Kiwix JS UWP/Electron/NWJS</a> to find an app version that will run fully offline.</p>';
                uiUtil.systemAlert(message);
                this.checked = true;
                params.allowInternetAccess = true;
                return;
            } else if (!/UWP/.test(params.appType)) {
                uiUtil.systemAlert("This PWA can run offline, but to be absolutely sure that it won't contact the server to update itself, you should shut " +
                    'off the Internet connection on your computer. By design, the PWA spec allows an offline app to check whether the Service Worker ' +
                    'code has changed, and this app cannot override that completely.');
            } else {
                message = '<p>This will switch to using locally packaged code only. Configuration settings may be lost.</p>' +
                    '<p><b>WARNING:</b> App will re-load in jQuery mode!</p>';
                var that = this;
                var launchLocal = function () {
                    settingsStore.setItem('allowInternetAccess', false, Infinity);
                    var uriParams = '?allowInternetAccess=false&contentInjectionMode=jquery';
                    // Commented line below causes crash when there are too many archives
                    // uriParams += '&listOfArchives=' + encodeURIComponent(settingsStore.getItem('listOfArchives'));
                    uriParams += '&lastSelectedArchive=' + encodeURIComponent(params.storedFile);
                    uriParams += '&lastPageVisit=' + encodeURIComponent(params.lastPageVisit);
                    // Void the PWA_launch signal so that user will be asked again next time
                    params.localUWPSettings.PWA_launch = '';
                    window.location.href = 'ms-appx-web:///www/index.html' + uriParams;
                    throw 'Beam me down, Scotty!';
                };
                uiUtil.systemAlert(message, 'Information', true, 'Cancel', 'Reload app').then(function (response) {
                    if (response) {
                        launchLocal();
                    } else {
                        that.checked = true;
                        params.allowInternetAccess = true;
                        document.getElementById('btnConfigure').click();
                    }
                });
            }
        }
    } else {
        // We can check for updates if the user has allowed Internet access
        checkUpdateServer();
    }
    settingsStore.setItem('allowInternetAccess', params.allowInternetAccess, Infinity);
    library.style.borderColor = '';
    library.style.borderStyle = '';
});
document.getElementById('cssCacheModeCheck').addEventListener('change', function () {
    params.cssCache = this.checked;
    settingsStore.setItem('cssCache', params.cssCache, Infinity);
    params.themeChanged = true;
});
document.getElementById('navButtonsPosCheck').addEventListener('change', function(e) {
    params.navButtonsPos = e.target.checked ? 'top' : 'bottom';
    settingsStore.setItem('navButtonsPos', params.navButtonsPos, Infinity);
    uiUtil.systemAlert('This setting will be applied on next app launch');           
});
$('input:checkbox[name=imageDisplayMode]').on('change', function (e) {
    if (params.contentInjectionMode === 'serviceworker' && !this.checked) {
        uiUtil.systemAlert('Image display can only be turned off in JQuery mode!');
        this.checked = true;
        return;
    }
    params.imageDisplay = this.checked ? true : false;
    params.imageDisplayMode = this.checked ? 'progressive' : 'manual';
    params.themeChanged = params.imageDisplay; //Only reload page if user asked for all images to be displayed
    settingsStore.setItem('imageDisplay', params.imageDisplay, Infinity);
});
document.getElementById('manipulateImagesCheck').addEventListener('click', function () {
    params.manipulateImages = this.checked;
    settingsStore.setItem('manipulateImages', params.manipulateImages, Infinity);
    if (this.checked && !params.displayHiddenBlockElements && !params.noWarning) {
        if (/UWP/.test(params.appType)) {
            uiUtil.systemAlert('<p><b>WORKAROUND FOR UWP APP:</b> To save an image to disk, please select the ' +
                '"Download or open current article" option below, load the article you require, and export it to a browser window by clicking the breakout icon.</p>' +
                '<p>You will then be able to right-click or long-press images in the exported page and save them.</p>');
        } else if (window.nw) {
            uiUtil.systemAlert('Unfortunately there is currently no way to save an image to disk in the NWJS version of this app.<br>You can do this in the PWA version: please visit https://pwa.kiwix.org.');
        } else if (params.contentInjectionMode === 'serviceworker' && appstate.selectedArchive
            && !/wikipedia|wikivoyage|mdwiki|wiktionary/i.test(appstate.selectedArchive._file.name)) {
            uiUtil.systemAlert('Please be aware that Image manipulation can interfere with non-Wikimedia ZIMs (particularly ZIMs that have active content). If you cannot access the articles in such a ZIM, please turn this setting off.');
        } else if (/PWA/.test(params.appType) && params.contentInjectionMode === 'jquery') {
            uiUtil.systemAlert('Be aware that this option may interfere with active content if you switch to Service Worker mode.');
        }
    }
    params.themeChanged = true;
});
['btnReset', 'btnReset2'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function () {
        settingsStore.reset();
    });
});
document.getElementById('btnRefreshApp').addEventListener('click', function () {
    window.location.reload();
});

document.getElementById('bypassAppCacheCheck').addEventListener('change', function () {
    if (params.contentInjectionMode !== 'serviceworker') {
        uiUtil.systemAlert('This setting can only be used in Service Worker mode!');
        this.checked = false;
    } else {
        params.appCache = !this.checked;
        settingsStore.setItem('appCache', params.appCache, Infinity);
        settingsStore.reset('cacheAPI');
    }
    // This will also send any new values to Service Worker
    refreshCacheStatus();
});
document.getElementById('disableDragAndDropCheck').addEventListener('change', function () {
    params.disableDragAndDrop = this.checked ? true : false;
    settingsStore.setItem('disableDragAndDrop', params.disableDragAndDrop, Infinity);
    uiUtil.systemAlert('<p>We will now attempt to reload the app to apply the new setting.</p>' + 
        '<p>(If you cancel, then the setting will only be applied when you next start the app.)</p>', 'Reload app', true).then(function (result) {
        if (result) {
            window.location.reload();
        }
    });
});
$('input:checkbox[name=hideActiveContentWarning]').on('change', function () {
    params.hideActiveContentWarning = this.checked ? true : false;
    settingsStore.setItem('hideActiveContentWarning', params.hideActiveContentWarning, Infinity);
    refreshCacheStatus();
});

// Function to restore the fullscreen/orientation lock state on user click in-app
// This is necessary because the browser will not restore the state without a user gesture
var refreshFullScreen = function (evt) {
    // Don't react if user is selecting an archive or setting the lock orientation
    if (/archiveFilesLegacy|lockDisplayOrientationDrop/.test(evt.target.id)) return;
    // Don't react when picking archive or directory with the File System Access API (because entering fullscreen blocks the permissions prompt)
    if (evt.target.parentElement && evt.target.parentElement.id === 'archiveList' && window.showDirectoryPicker) return;
    if (params.lockDisplayOrientation && (evt.target.id === 'btnAbout' || /glyphicon-(resize-small|fullscreen)/.test(evt.target.className))) {
        if (uiUtil.appIsFullScreen()) {
            // Cancel fullscreen mode
            uiUtil.lockDisplayOrientation().then(function () {
                setDynamicIcons();
            });
            params.lockDisplayOrientation = '';
            settingsStore.setItem('lockDisplayOrientation', '', Infinity);
            document.getElementById('lockDisplayOrientationDrop').value = '';
        } else {
            // Enter fullscreen mode
            uiUtil.lockDisplayOrientation(params.lockDisplayOrientation).then(function () {
                setDynamicIcons();
                resizeIFrame();
            }).catch(function () {
                setDynamicIcons();
                resizeIFrame();
            });
        }
    } else {
        if (params.lockDisplayOrientation) uiUtil.lockDisplayOrientation(params.lockDisplayOrientation).catch(function () {
            return;
        });
    }
};
// Add event listener to the app UI
document.getElementById('search-article').addEventListener('mouseup', refreshFullScreen);
// Set the UI for the current fullscreen/orientation lock state
document.getElementById('lockDisplayOrientationDrop').value = params.lockDisplayOrientation || '';

document.getElementById('lockDisplayOrientationDrop').addEventListener('change', function (event) {
    var that = this;
    if (event.target.value) {
        return uiUtil.lockDisplayOrientation(event.target.value).then(function (rtn) {
            if (rtn === 'unsupported') {
                uiUtil.systemAlert('The Screen Orientation Lock API is not supported on this device!');
                that.value = params.lockDisplayOrientation || '';
            } else {
                params.lockDisplayOrientation = event.target.value || '';
                settingsStore.setItem('lockDisplayOrientation', params.lockDisplayOrientation, Infinity);
                if (rtn === 'click') {
                    uiUtil.systemAlert((!params.PWAInstalled && /iOS/.test(params.appType) ?
                        '<p>In Safari on iOS, consider adding this app to your homescreen (Share --&gt Add to Home), which will give a better experience than full-screen mode.</p>' : '')
                         + '<p>Please click the &nbsp;<span class="glyphicon glyphicon-fullscreen"></span>&nbsp; button top-right to enter full-screen mode.</p>'
                    );
                }
            }
            setDynamicIcons();
        }).catch(function (err) {
            // Note that in desktop contexts, the API might reject, but could still work
            if (err.name === 'NotSupportedError') {
                params.lockDisplayOrientation = event.target.value || '';
                settingsStore.setItem('lockDisplayOrientation', params.lockDisplayOrientation, Infinity);
                that.value = params.lockDisplayOrientation || '';
                if (params.lockDisplayOrientation) uiUtil.systemAlert('<p>The following error was received (this is expected on Desktop devices):</p>' + 
                    '<blockquote><code>' + err.toString() + '</code></blockquote>' +
                    "<p>If screen lock doesn't work, please change setting back to 'Normal' or try a different option.</p>");
            } else {
                uiUtil.systemAlert((!params.PWAInstalled && /iOS/.test(params.appType) ?
                '<p>In Safari on iOS, consider adding this app to your homescreen (Share --&gt Add to Home) isntead.</p>' : '')
                 + '<p>There was an error setting the requested screen state:</p><blockquote><code>' + err.toString() +  '</code></blockquote>');
                that.value = params.lockDisplayOrientation || '';
            }
            setDynamicIcons();
        });
    } else {
        params.lockDisplayOrientation = '';
        settingsStore.setItem('lockDisplayOrientation', '', Infinity);
        uiUtil.lockDisplayOrientation().then(function () {
            setDynamicIcons();
        }).catch(function () {
            return;
        });
    }
});
document.getElementById('debugLibzimASMDrop').addEventListener('change', function (event) {
    var that = this;
    var message = '<p>App will reload to apply the new setting.</p>'
    if (event.target.value) message += '<p><i>Please be aware that leaving this override setting on can have anomalous effects, ' + 
        'e.g. the app will no longer check whether the OS supports full-text searching and searches may fail silently.</i></p>'
    uiUtil.systemAlert(message,
        'Developer option!', true).then(function (confirm) {
        if (confirm) {
            params.debugLibzimASM = event.target.value || false;
            settingsStore.setItem('debugLibzimASM', params.debugLibzimASM, Infinity);
            window.location.reload();
        } else {
            that.value = params.debugLibzimASM || '';
        }
    });
});
$('input:checkbox[name=openExternalLinksInNewTabs]').on('change', function () {
    params.openExternalLinksInNewTabs = this.checked ? true : false;
    settingsStore.setItem('openExternalLinksInNewTabs', params.openExternalLinksInNewTabs, Infinity);
    params.themeChanged = true;
});
document.getElementById('tabOpenerCheck').addEventListener('click', function () {
    params.windowOpener = this.checked ? 'tab' : false;
    if (!params.windowOpener && !params.noWarning) {
        uiUtil.systemAlert('Please note that due to the Content Secuirty Policy, external links and PDFs always open in a new tab or window, regardless of this setting.');
    }
    if (params.windowOpener && /UWP\|PWA/.test(params.appType) && params.contentInjectionMode === 'jquery') {
        if (!params.noWarning) uiUtil.systemAlert('<p>In this UWP app, opening a new browsable window only works in Service Worker mode.</p>' + 
            '<p>Your system appears to support SW mode, so please try switching to it in Expert Settings below.</p>' +
            '<p>If your system does not support SW mode, then use the more basic "Download or open current article" feature below.</p>');
        params.windowOpener = false;
    } else if (params.windowOpener && /iOS|UWP$/.test(params.appType)) {
        if (!params.noWarning) uiUtil.systemAlert('<p>This option is not currently supported ' + (/iOS/.test(params.appType) ?
            'on iOS devices because programmatic opening of windows is forbidden. However, the native long-press feature may work.</p>' :
            'in UWP apps that cannot use Service Worker mode.</p><p>Please try the more basic "Download or open current article" feature below instead.</p>'));
        params.windowOpener = false;
    }
    settingsStore.setItem('windowOpener', params.windowOpener, Infinity);
    if (params.windowOpener && params.allowHTMLExtraction) {
        if (!params.noWarning) uiUtil.systemAlert('Enabling this option disables the more basic "Download or open current article" option below.');
        document.getElementById('allowHTMLExtractionCheck').click();
    }
    setWindowOpenerUI();
    params.themeChanged = true;
});
document.getElementById('winOpenerCheck').addEventListener('click', function () {
    var tabCheck = document.getElementById('tabOpenerCheck');
    params.windowOpener = this.checked ? 'window' : tabCheck.checked ? 'tab' : false;
    settingsStore.setItem('windowOpener', params.windowOpener, Infinity);
    setWindowOpenerUI();
});
document.getElementById('dblRightClickCheck').addEventListener('click', function () {
    var tabCheck = document.getElementById('tabOpenerCheck');
    params.rightClickType = this.checked ? 'double' : tabCheck.checked ? 'single' : false;
    settingsStore.setItem('rightClickType', params.rightClickType, Infinity);
    setWindowOpenerUI();
});
function setWindowOpenerUI() {
    var woHelp = document.getElementById('winOpenerHelp');
    var newWin = document.getElementById('openInNewWindow');
    var tabCheck = document.getElementById('tabOpenerCheck');
    var winCheck = document.getElementById('winOpenerCheck');
    var rtClickType = document.getElementById('dblRightClickCheck');
    if (params.rightClickType === 'double') rtClickType.checked = true;    
    if (params.windowOpener === 'window') {
        newWin.style.display = 'block';
        woHelp.style.display = 'block';
        tabCheck.checked = true;
        winCheck.checked = true;
        woHelp.innerHTML = 'If blocked, allow popups permanently for this app and try again. May not work in mobile contexts.';
        if (params.rightClickType === 'double') woHelp.innerHTML += '<br />Single right-click will open context menu, double right-click will open new window.';
    } else if (params.windowOpener === 'tab') {
        tabCheck.checked = true;
        winCheck.checked = false;
        newWin.style.display = 'block';
        woHelp.style.display = 'block';
        woHelp.innerHTML = '';
        woHelp.innerHTML = 'In some cases a window may open regardless of this setting. May not work in mobile contexts.';
        if (params.rightClickType === 'double') woHelp.innerHTML += '<br />Single right-click will open context menu, double right-click will open new tab.';
    } else { // The options are turned off
        tabCheck.checked = false;
        winCheck.checked = false;
        rtClickType.checked = false;
        woHelp.style.display = 'none';
        newWin.style.display = 'none';
    }
}
document.getElementById('allowHTMLExtractionCheck').addEventListener('click', function (e) {
    params.allowHTMLExtraction = e.target.checked;
    var alertMessage = '';
    if (params.allowHTMLExtraction) {
        if (params.windowOpener) alertMessage = '<p>Enabling this option disables the more advanced tab/window opening option above.</p>';
        if (/iOS/.test(params.appType)) {
            alertMessage = '<p><b>This option will only work if you turn off popup blocking in your iOS browser settings.</b><p>';
        }
        if (params.contentInjectionMode === 'serviceworker') {
            alertMessage = '<p>Please be aware that the "Download or open current article" functionality can interfere badly with non-Wikimedia ZIMs (particularly ZIMs that have active content). ' + 
            'If you cannot access the articles in such a ZIM, please turn this setting off.</p>' + alertMessage;
        } else if (/PWA/.test(params.appType)) {
            alertMessage += '<p>Be aware that this option may interfere with active content if you switch to Service Worker mode.</p>';
        }
        uiUtil.systemAlert(alertMessage);
        params.windowOpener = false;
        settingsStore.setItem('windowOpener', params.windowOpener, Infinity);
        setWindowOpenerUI();
    }
    settingsStore.setItem('allowHTMLExtraction', params.allowHTMLExtraction, Infinity);
    params.themeChanged = true;
});
$('input:text[name=alphaChar]').on('change', function (e) {
    params.alphaChar = this.value.length == 1 ? this.value : params.alphaChar;
    this.value = params.alphaChar;
    settingsStore.setItem('alphaChar', params.alphaChar, Infinity);
});
$('input:text[name=omegaChar]').on('change', function (e) {
    params.omegaChar = this.value.length == 1 ? this.value : params.omegaChar;
    this.value = params.omegaChar;
    settingsStore.setItem('omegaChar', params.omegaChar, Infinity);
});
var titleSearchRangeVal = document.getElementById('titleSearchRangeVal');
document.getElementById('titleSearchRange').addEventListener('change', function(e) {
    settingsStore.setItem('maxSearchResultsSize', e.target.value, Infinity);
    params.maxSearchResultsSize = ~~e.target.value;
    titleSearchRangeVal.innerHTML = e.target.value;
});
document.getElementById('titleSearchRange').addEventListener('input', function(e) {
    titleSearchRangeVal.innerHTML = e.target.value;
});
document.getElementById('hideToolbarsCheck').addEventListener('click', function () {
    // This code implements a tri-state checkbox
    // DEV: You cannot use jQuery to add the click event listener above: it doesn't work properly!
    if (this.readOnly) this.checked = this.readOnly = false;
    else if (!this.checked) this.readOnly = this.indeterminate = true;
    // How to reverse the order of the checkbox
    // if (this.readOnly) { this.checked = true; this.readOnly = false; }
    // else if (this.checked) this.readOnly = this.indeterminate = true;
    params.hideToolbars = this.indeterminate ? "top" : this.checked;
    document.getElementById('hideToolbarsState').innerHTML = params.hideToolbars == "top" ? "top only" : params.hideToolbars ? "both" : "never";
    settingsStore.setItem('hideToolbars', params.hideToolbars, Infinity);
    checkToolbar();
});
Array.prototype.slice.call(document.querySelectorAll('.aboutLink')).forEach(function (link) {
    link.addEventListener('click', function () {
        document.getElementById('btnAbout').click();
    });
});


var iframe = document.getElementById('articleContent');
var header = document.getElementById('top');
var footer = document.getElementById('footer');
var prefix = document.getElementById('prefix');
var findInArticle = document.getElementById('findInArticle');
var navbarDim;
var footerDim;
var oldScrollY;
var newScrollY;
var throttle = 0;
header.style.transition = "transform 500ms";
iframe.style.transition = "transform 500ms";
iframe.style.zIndex = 0;
footer.style.transition = "transform 500ms";

var scrollFunction = function () {
    if (throttle) return;
    throttle = 1;
    newScrollY = iframe.contentWindow.pageYOffset;
    // Hide the toolbars if user has scrolled and search elements are not selected
    if (newScrollY - oldScrollY > 0 && document.activeElement !== prefix 
        && document.activeElement !== findInArticle) {
        // If the header and/or footer have not already been hidden
        if (/\(0p?x?\)/.test(header.style.transform)) {
            throttle = 2;
            setTimeout(function() {
                if (newScrollY > navbarDim.height) {
                    header.style.transform = 'translateY(-' + (navbarDim.height - 2) + 'px)';
                    iframe.style.transform = 'translateY(-' + (navbarDim.height - 2) + 'px)';
                    if (params.hideToolbars === true) // Only hide footer if requested
                        footer.style.transform = 'translateY(' + (footerDim.height - 2) + 'px)';
                }
                throttle = 0;
            }, 200);
        }
    } else if (newScrollY - oldScrollY < 0) {
        header.style.zIndex = 1;
        header.style.transform = 'translateY(0)';
        // Needed for Windows Mobile to prevent header disappearing beneath iframe
        iframe.style.transform = 'translateY(-1px)';
        footer.style.transform = 'translateY(0)';
    }
    oldScrollY = newScrollY;
    throttle = throttle < 2 ? 0 : throttle;
};

function checkToolbar() {
    if (document.getElementById('row2').style.display === "none") {
        // Check state of toolbar (this returns it to its original state if it was changed by find-in-article)
        params.hideToolbars = settingsStore.getItem('hideToolbars');
        params.hideToolbars = params.hideToolbars === null ? true : params.hideToolbars === 'true' ? true : params.hideToolbars === 'false' ? false : params.hideToolbars;
    }
    oldScrollY = iframe.contentWindow.pageYOffset;
    navbarDim = document.getElementById('navbar').getBoundingClientRect();
    footerDim = footer.getBoundingClientRect();
    var doc = iframe.contentDocument ? iframe.contentDocument.documentElement : null;
    if (doc) doc.style.transition = "transform 500ms";

    iframe.contentDocument.removeEventListener('scroll', scrollFunction);
    if (params.hideToolbars) {
        // Shift the iframe up and the document down, and increase height of iframe
        iframe.style.height = window.innerHeight + navbarDim +
            (params.hideToolbars === true ? footerDim.height : 0) + 'px';
        // iframe.style.transform = 'translateY(-' + navbarDim.height + 'px)';
        if (doc) {
            // doc.style.transform = 'translateY(' + navbarDim.height + 'px)'; 
            iframe.contentDocument.addEventListener('scroll', scrollFunction);
        }
        scrollFunction();
    } else {
        // Ensure toolbar is restored
        setTimeout(function () {
            header.style.zIndex = 1;
            header.style.transform = 'translateY(0)';
            footer.style.transform = 'translateY(0)';
            // DEV: Moving the iframe up by 1 pixel bizarrely solves the bug with the toolbar disappearing benath the iframe
            iframe.style.transform = 'translateY(-1px)';
            if (doc) doc.style.removeProperty('transform');
            iframe.style.height = window.innerHeight + 'px';
        }, 500);
    }
}

// Set up hook into Windows ViewManagement uiSettings if needed
var uiSettings = null;
initializeUISettings();

function initializeUISettings() {
    var checkAuto = params.cssUITheme == 'auto' || params.cssTheme == 'auto';
    // Support for UWP
    if (checkAuto && typeof Windows !== 'undefined' && Windows.UI && Windows.UI.ViewManagement) {
        uiSettings = new Windows.UI.ViewManagement.UISettings();
        uiSettings.oncolorvalueschanged = function () {
            params.cssTheme = settingsStore.getItem('cssTheme');
            if (params.cssUITheme == 'auto') cssUIThemeGetOrSet('auto');
            if (params.cssTheme == 'auto') switchCSSTheme();
        };
    }
    // Support for other contexts (Firefox, Chromium, Electron, NWJS)
    if (checkAuto && window.matchMedia('(prefers-color-scheme)').media !== 'not all') {
        uiSettings = window.matchMedia('(prefers-color-scheme:dark)');
        uiSettings.onchange = function () {
            params.cssTheme = settingsStore.getItem('cssTheme');
            if (params.cssUITheme == 'auto') cssUIThemeGetOrSet('auto');
            if (params.cssTheme == 'auto') switchCSSTheme();
        };
    }
}
// Code below is needed on startup to show or hide the inverted and DarkReader theme checkboxes; 
// similar code also runs in switchCSSTheme(), but that is not evoked on startup
if (params.cssTheme == 'auto') document.getElementById('darkInvert').style.display = cssUIThemeGetOrSet('auto', true) == 'light' ? 'none' : 'block';
if (params.cssTheme == 'auto') document.getElementById('darkDarkReader').style.display = params.contentInjectionMode === 'serviceworker' ? cssUIThemeGetOrSet('auto', true) == 'light' ? 'none' : 'block' : 'none';
document.getElementById('cssUIDarkThemeCheck').addEventListener('click', function () {
    //This code implements a tri-state checkbox
    // if (this.readOnly) this.checked = this.readOnly = false;
    // else if (!this.checked) this.readOnly = this.indeterminate = true;
    //Code below shows how to invert the order
    if (this.readOnly) { this.checked = true; this.readOnly = false; }
    else if (this.checked) this.readOnly = this.indeterminate = true;
    params.cssUITheme = this.indeterminate ? "auto" : this.checked ? 'dark' : 'light';
    if (!uiSettings) initializeUISettings();
    settingsStore.setItem('cssUITheme', params.cssUITheme, Infinity);
    document.getElementById('cssUIDarkThemeState').innerHTML = params.cssUITheme;
    cssUIThemeGetOrSet(params.cssUITheme);
    //Make subsequent check valid if params.cssTheme is "invert" rather than "dark"
    if (params.cssUITheme != params.cssTheme) document.getElementById('cssWikiDarkThemeCheck').click();
    params.cssThemeOriginal = null;
});
document.getElementById('cssWikiDarkThemeCheck').addEventListener('click', function () {
    // if (this.readOnly) this.checked = this.readOnly = false;
    // else if (!this.checked) this.readOnly = this.indeterminate = true;
    // Invert order:
    if (this.readOnly) { this.checked = true; this.readOnly = false; }
    else if (this.checked) this.readOnly = this.indeterminate = true;
    params.cssTheme = this.indeterminate ? "auto" : this.checked ? 'dark' : 'light';
    if (!uiSettings) initializeUISettings();
    var determinedValue = params.cssTheme;
    if (params.cssTheme == "auto") determinedValue = cssUIThemeGetOrSet('auto', true);
    if (determinedValue == "light") document.getElementById('footer').classList.remove("darkfooter");
    if (params.cssTheme == "light") document.getElementById('cssWikiDarkThemeInvertCheck').checked = false;
    if (determinedValue == "dark") document.getElementById('footer').classList.add("darkfooter");
    document.getElementById('darkInvert').style.display = determinedValue == 'light' ? 'none' : 'block';
    document.getElementById('darkDarkReader').style.display = params.contentInjectionMode === 'serviceworker' ? determinedValue == 'light' ? 'none' : 'block' : 'none';
    params.cssTheme = document.getElementById('cssWikiDarkThemeInvertCheck').checked && determinedValue == 'dark' ? 'invert' : params.cssTheme;
    params.cssTheme = document.getElementById('darkDarkReader').checked && determinedValue == 'dark' ? 'darkReader' : params.cssTheme;
    document.getElementById('cssWikiDarkThemeState').innerHTML = params.cssTheme;
    settingsStore.setItem('cssTheme', params.cssTheme, Infinity);
    switchCSSTheme();
    params.cssThemeOriginal = null;
});
document.getElementById('cssWikiDarkThemeInvertCheck').addEventListener('click', function () {
    if (this.checked) {
        params.cssTheme = 'invert';
        document.getElementById('cssWikiDarkThemeDarkReaderCheck').checked = false;
    } else {
        var darkThemeCheckbox = document.getElementById('cssWikiDarkThemeCheck');
        params.cssTheme = darkThemeCheckbox.indeterminate ? 'auto' : darkThemeCheckbox.checked ? 'dark' : 'light';
    }
    settingsStore.setItem('cssTheme', params.cssTheme, Infinity);
    document.getElementById('cssWikiDarkThemeState').innerHTML = params.cssTheme;
    switchCSSTheme();
    params.cssThemeOriginal = null;
});
document.getElementById('cssWikiDarkThemeDarkReaderCheck').addEventListener('click', function () {
    if (this.checked) {
        params.cssTheme = 'darkReader';
        document.getElementById('cssWikiDarkThemeInvertCheck').checked = false;
    } else {
        var darkThemeCheckbox = document.getElementById('cssWikiDarkThemeCheck');
        params.cssTheme = darkThemeCheckbox.indeterminate ? 'auto' : darkThemeCheckbox.checked ? 'dark' : 'light';
    }
    settingsStore.setItem('cssTheme', params.cssTheme, Infinity);
    document.getElementById('cssWikiDarkThemeState').innerHTML = params.cssTheme;
    switchCSSTheme();
    params.cssThemeOriginal = null;
});

function cssUIThemeGetOrSet(value, getOnly) {
    if (value === 'auto') {
        value = 'light'; // Default that most people expect
        if (uiSettings) {
            // We need to check the system theme
            if (uiSettings.getColorValue) {
                // Value 0 below is the 'background' constant in array Windows.UI.ViewManagement.UIColorType
                var colour = uiSettings.getColorValue(0);
                value = (colour.b + colour.g + colour.r) <= 382 ? 'dark' : 'light';
            } else {
                // Generic support for modern browser contexts
                value = uiSettings.matches ? 'dark' : 'light';
            }
        }
    }
    if (getOnly) return value;
    var elements;
    if (value == 'dark') {
        document.getElementsByTagName('body')[0].classList.add("dark");
        document.getElementById('archiveFilesLegacy').classList.add("dark");
        document.getElementById('footer').classList.add("darkfooter");
        document.getElementById('archiveFilesLegacy').classList.remove("btn");
        document.getElementById('findInArticle').classList.add("dark");
        document.getElementById('prefix').classList.add("dark");
        elements = document.querySelectorAll(".settings");
        for (var i = 0; i < elements.length; i++) {
            elements[i].style.border = "1px solid darkgray";
        }
        document.getElementById('kiwixIcon').src = /wikivoyage/i.test(params.storedFile) ? "img/icons/wikivoyage-white-32.png" : /medicine|mdwiki/i.test(params.storedFile) ? "img/icons/wikimed-lightblue-32.png" : "img/icons/kiwix-32.png";
        if (/wikivoyage/i.test(params.storedFile)) document.getElementById('kiwixIconAbout').src = "img/icons/wikivoyage-90-white.png";
    }
    if (value == 'light') {
        document.getElementsByTagName('body')[0].classList.remove("dark");
        document.getElementById('search-article').classList.remove("dark");
        document.getElementById('footer').classList.remove("darkfooter");
        document.getElementById('archiveFilesLegacy').classList.remove("dark");
        document.getElementById('archiveFilesLegacy').classList.add("btn");
        document.getElementById('findInArticle').classList.remove("dark");
        document.getElementById('prefix').classList.remove("dark");
        elements = document.querySelectorAll(".settings");
        for (var i = 0; i < elements.length; i++) {
            elements[i].style.border = "1px solid black";
        }
        document.getElementById('kiwixIcon').src = /wikivoyage/i.test(params.storedFile) ? "img/icons/wikivoyage-black-32.png" : /medicine|mdwiki/i.test(params.storedFile) ? "img/icons/wikimed-blue-32.png" : "img/icons/kiwix-blue-32.png";
        if (/wikivoyage/i.test(params.packagedFile)) document.getElementById('kiwixIconAbout').src = "img/icons/wikivoyage-90.png";
    }
    refreshCacheStatus();
    return value;
}

function switchCSSTheme() {
    var doc = window.frames[0].frameElement.contentDocument;
    var treePath = params.lastPageVisit.replace(/[^/]+\/(?:[^/]+$)?/g, "../");
    //If something went wrong, use the page reload method
    if (!treePath) {
        params.themeChanged = true;
        return;
    }
    var styleSheets = doc.getElementsByTagName("link");
    //Remove any dark theme, as we don't know whether user switched from light to dark or from inverted to dark, etc.
    for (var i = styleSheets.length - 1; i > -1; i--) {
        if (~styleSheets[i].href.search(/\/style-dark/)) {
            styleSheets[i].disabled = true;
            styleSheets[i].parentNode.removeChild(styleSheets[i]);
        }
    }
    var determinedWikiTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssTheme;
    var breakoutLink = doc.getElementById('breakoutLink');
    // Construct an absolute reference becuase Service Worker needs this
    var prefix = window.location.pathname.replace(/\/[^/]*$/, '');
    if (determinedWikiTheme !== 'light' && params.cssTheme !== 'darkReader') {
        var link = doc.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('type', 'text/css');
        link.setAttribute('href', prefix + (determinedWikiTheme == 'dark' ? '/-/s/style-dark.css' : '/-/s/style-dark-invert.css'));
        doc.head.appendChild(link);
        if (articleWindow.DarkReader) {
            articleWindow.DarkReader.disable();
        }
        if (breakoutLink) breakoutLink.src = prefix + '/img/icons/new_window_lb.svg';
    } else {
        if (params.contentInjectionMode === 'serviceworker' && params.cssTheme === 'darkReader') {
            if (!articleWindow.DarkReader) {
                var darkReader = doc.createElement('script');
                darkReader.setAttribute('type', 'text/javascript');
                darkReader.setAttribute('src', prefix + '/js/lib/darkreader.min.js');
                doc.head.appendChild(darkReader);
            }
            setTimeout(function () {
                articleWindow.DarkReader.setFetchMethod(articleWindow.fetch);
                articleWindow.DarkReader.enable();
            }, 500);
        }
        if (breakoutLink) breakoutLink.src = prefix + '/img/icons/new_window.svg';
    }
    document.getElementById('darkInvert').style.display = determinedWikiTheme == 'light' ? 'none' : 'block';
    document.getElementById('darkDarkReader').style.display = params.contentInjectionMode === 'serviceworker' ? determinedWikiTheme == 'light' ? 'none' : 'block' : 'none';
}

document.getElementById('resetDisplayOnResizeCheck').addEventListener('click', function () {
    params.resetDisplayOnResize = this.checked;
    settingsStore.setItem('resetDisplayOnResize', this.checked, Infinity);
    resizeIFrame(this.checked);
});
$('input:checkbox[name=rememberLastPage]').on('change', function (e) {
    if (params.rememberLastPage && this.checked) document.getElementById('rememberLastPageCheck').checked = true;
    params.rememberLastPage = this.checked ? true : false;
    settingsStore.setItem('rememberLastPage', params.rememberLastPage, Infinity);
    if (!params.rememberLastPage) {
        settingsStore.setItem('lastPageVisit', "", Infinity);
        // DEV: replace this with cache.clear when you have repaired that method
        cache.setArticle(params.lastPageVisit.replace(/.+@kiwixKey@/, ''), params.lastPageVisit.replace(/@kiwixKey@.+/, ''), '', function(){});
        params.lastPageHTML = "";
    }
});
document.getElementById('cachedAssetsModeRadioTrue').addEventListener('change', function (e) {
    if (e.target.checked) {
        settingsStore.setItem('assetsCache', true, Infinity);
        params.assetsCache = true;
        refreshCacheStatus();
    }
});
document.getElementById('cachedAssetsModeRadioFalse').addEventListener('change', function (e) {
    if (e.target.checked) {
        settingsStore.setItem('assetsCache', false, Infinity);
        params.assetsCache = false;
        // Delete all caches
        cache.clear('all', refreshCacheStatus);
    }
});
$('input:radio[name=cssInjectionMode]').on('click', function (e) {
    params.cssSource = this.value;
    settingsStore.setItem('cssSource', params.cssSource, Infinity);
    params.themeChanged = true;
});
document.getElementById('removePageMaxWidthCheck').addEventListener('click', function () {
    //This code implements a tri-state checkbox
    if (this.readOnly) this.checked = this.readOnly = false;
    else if (!this.checked) this.readOnly = this.indeterminate = true;
    params.removePageMaxWidth = this.indeterminate ? "auto" : this.checked;
    document.getElementById('pageMaxWidthState').textContent = (params.removePageMaxWidth == "auto" ? "auto" : params.removePageMaxWidth ? "always" : "never");
    settingsStore.setItem('removePageMaxWidth', params.removePageMaxWidth, Infinity);
    removePageMaxWidth();
});
document.getElementById('displayHiddenBlockElementsCheck').addEventListener('click', function () {
    if (this.readOnly) this.checked = this.readOnly = false;
    else if (!this.checked) this.readOnly = this.indeterminate = true;
    params.displayHiddenBlockElements = this.indeterminate ? "auto" : this.checked;
    document.getElementById('displayHiddenElementsState').textContent = (params.displayHiddenBlockElements == "auto" ? "auto" : params.displayHiddenBlockElements ? "always" : "never");
    settingsStore.setItem('displayHiddenBlockElements', params.displayHiddenBlockElements, Infinity);
    if (params.contentInjectionMode === 'serviceworker') {
        var message = '';
        if (this.checked && !params.manipulateImages) {
            message += 'We need to turn on "Allow image manipulation" (below) in order to display hidden images. Please be aware that ' +
                'image manipulation can interfere badly with non-Wikimedia ZIMs that contain active content, so please turn it off if ' +
                'you experience problems.';
            document.getElementById('manipulateImagesCheck').click();
        }
        if (this.checked && /UWP/.test(params.appType) && params.windowOpener && params.cssSource !== 'desktop') {
            if (message) message += '\n\n';
            message += 'Please note that hidden elements will not be displayed in any NEW windows or tabs that you open in this UWP app. If you want to see hidden elements in new windows in *Wikimedia* ZIMs, please switch to Desktop style (above), where they are shown by default.';
        }
        if (!params.displayHiddenBlockElements && params.manipulateImages) {
            message += 'We are turning off the image manipulation option because it is no longer needed to display hidden elements. You may turn it back on if you need it for another reason.';
            document.getElementById('manipulateImagesCheck').click();
        }
        if (message) uiUtil.systemAlert(message);
    }
    // Forces page reload
    params.themeChanged = true;
});

/**
 * Removes the WikiMedia max-page-width restrictions using DOM methods on the articleWindow
 */
function removePageMaxWidth() {
    if (!appstate.wikimediaZimLoaded) return;
    var zimType;
    var cssSource;
    var contentElement;
    var docStyle;
    var updatedCssText;
    var doc = articleWindow.document;
    if (!doc || !doc.head) return;
    zimType = /<link\b[^>]+(?:minerva|mobile)/i.test(doc.head.innerHTML) ? "mobile" : "desktop";
    cssSource = params.cssSource === "auto" ? zimType : params.cssSource;
    var idArray = ["content", "bodyContent"];
    for (var i = 0; i < idArray.length; i++) {
        contentElement = doc.getElementById(idArray[i]);
        if (!contentElement) continue;
        docStyle = contentElement.style;
        if (!docStyle) continue;
        if (contentElement.className === "mw-body") {
            docStyle.padding = "1em";
            docStyle.border = "1px solid #a7d7f9";
        }
        if (params.removePageMaxWidth === "auto") {
            updatedCssText = cssSource === 'desktop' ? '100%' : window.innerWidth > 1012 ? '94%' :
                // /android/i.test(params.appType) ? '98%' : 
                '55.8em';
            docStyle.maxWidth = updatedCssText;
            docStyle.cssText = docStyle.cssText.replace(/max-width:[^;]+/i, 'max-width: ' + updatedCssText + ' !important');
            docStyle.border = "0";
        } else {
            updatedCssText = params.removePageMaxWidth ? "100%" : "55.8em";
            docStyle.maxWidth = updatedCssText;
            docStyle.cssText = docStyle.cssText.replace(/max-width:[^;]+/i, 'max-width: ' + updatedCssText + ' !important');
            if (params.removePageMaxWidth || zimType == "mobile") docStyle.border = "0";
        }
        docStyle.margin = "0 auto";
    }
    if (doc.body && doc.body.classList.contains('article-list-home')) {
        doc.body.style.padding = '2em';
    } 
}

document.getElementById('openAllSectionsCheck').addEventListener('click', function (e) {
    params.openAllSections = this.checked;
    settingsStore.setItem('openAllSections', params.openAllSections, Infinity);
    if (params.contentInjectionMode === 'serviceworker') {
        // We have to reload the article to respect user's choice
        goToArticle(params.lastPageVisit.replace(/@[^@].+$/, ''));
        return;
    }
    openAllSections();
});
document.getElementById('linkToWikimediaImageFileCheck').addEventListener('click', function () {
    params.linkToWikimediaImageFile = this.checked;
    settingsStore.setItem('linkToWikimediaImageFile', this.checked, Infinity);
    params.themeChanged = true;
});
document.getElementById('useOSMCheck').addEventListener('click', function () {
    params.mapsURI = this.checked ? 'https://www.openstreetmap.org/' : 'bingmaps:';
    settingsStore.setItem('mapsURI', params.mapsURI, Infinity);
    params.themeChanged = true;
});
$('input:radio[name=useMathJax]').on('click', function (e) {
    params.useMathJax = /true/i.test(this.value);
    settingsStore.setItem('useMathJax', params.useMathJax, Infinity);
    params.themeChanged = true;
});
var library = document.getElementById('libraryArea');
var unhideArchiveLibraryAnchors = document.getElementsByClassName("unhideLibrary");
for (var i = 0; i < unhideArchiveLibraryAnchors.length; i++) {
    unhideArchiveLibraryAnchors[i].addEventListener('click', function () {
        if (!params.showFileSelectors) document.getElementById('displayFileSelectorsCheck').click();
        library.style.borderColor = 'red';
        library.style.borderStyle = 'solid';
    });
}
document.getElementById('downloadTrigger').addEventListener('mousedown', function () {
    library.style.borderColor = '';
    library.style.borderStyle = '';
});

$('input:checkbox[name=displayFileSelectors]').on('change', function (e) {
    params.showFileSelectors = this.checked ? true : false;
    document.getElementById('rescanStorage').style.display = "block";
    document.getElementById('openLocalFiles').style.display = "none";
    document.getElementById('hideFileSelectors').style.display = params.showFileSelectors ? "block" : "none";
    document.getElementById('downloadLinksText').style.display = params.showFileSelectors ? "none" : "inline";
    document.getElementById('usage').style.display = params.showFileSelectors ? "none" : "inline";
    if (params.packagedFile && params.storedFile && params.storedFile != params.packagedFile) {
        currentArchiveLink.innerHTML = params.storedFile.replace(/\.zim$/i, '');
        currentArchive.style.display = params.showFileSelectors ? "none" : "block";
        document.getElementById('downloadLinksText').style.display = params.showFileSelectors ? "none" : "block";
    }
    settingsStore.setItem('showFileSelectors', params.showFileSelectors, Infinity);
    if (params.showFileSelectors) document.getElementById('configuration').scrollIntoView();
});

$(document).ready(function (e) {
    // Set initial behaviour (see also init.js)
    cssUIThemeGetOrSet(params.cssUITheme);
    //@TODO - this is initialization code, and should be in init.js (withoug jQuery)
    $('input:radio[name=cssInjectionMode]').filter('[value="' + params.cssSource + '"]').prop('checked', true);
    //DEV this hides file selectors if it is a packaged file -- add your own packaged file test to regex below
    if (params.packagedFile && !/wikipedia.en.100|ray.charles/i.test(params.fileVersion)) {
        document.getElementById('packagedAppFileSelectors').style.display = "block";
        document.getElementById('hideFileSelectors').style.display = "none";
        //document.getElementById('downloadLinksText').style.display = "none";
        if (params.showFileSelectors) {
            document.getElementById('hideFileSelectors').style.display = "block";
            document.getElementById('downloadLinksText').style.display = "inline";
        }
    }
    // Populate version info
    var versionSpans = document.getElementsByClassName('version');
    for (var i = 0; i < versionSpans.length; i++) {
        versionSpans[i].innerHTML = i ? params.appVersion : params.appVersion.replace(/\s+.*$/, "");
    }
    if (params.fileVersion && /UWP|Electron/.test(params.appType)) {
        var packagedInfoParas = document.getElementsByClassName('packagedInfo');
        var fileVersionDivs = document.getElementsByClassName('fileVersion');
        for (i = 0; i < fileVersionDivs.length; i++) {
            packagedInfoParas[i].style.display = 'block';
            fileVersionDivs[i].innerHTML = i ? params.fileVersion.replace(/\s+.+$/, '') : params.fileVersion;
        }
    }
    var appType = document.getElementById('appType');
    appType.innerHTML = /^(?=.*PWA).*UWP/.test(params.appType) &&
        /^https:/i.test(location.protocol) ? 'UWP (PWA) ' :
        /UWP/.test(params.appType) ? 'UWP ' : 
        window.nw ? 'NWJS ' : 
        /Electron/.test(params.appType) ? 'Electron ' : 
        /PWA/.test(params.appType) ? 'PWA ' : '';
    //Code below triggers display of modal info box if app is run for the first time, or it has been upgraded to new version
    if (settingsStore.getItem('appVersion') !== params.appVersion) {
        //  Update the installed version
        if (settingsStore.getItem('PWAInstalled')) {
            params.PWAInstalled = params.appVersion;
            settingsStore.setItem('PWAInstalled', params.PWAInstalled);
        }
        // One-time cleanup of idxDB files to delete deprecated databases if possible
        cache.idxDB('deleteNonCurrent', function (result) {
            if (result === false) console.log('Unable to delete old idxDB databases (this is normal in non-Chromium browsers');
            else console.log('Deleted ' + result + ' deprecated database(s).');
        });
        // On some platforms, bootstrap's jQuery functions have not been injected yet, so we have to run in a timeout
        setTimeout(function () {
            uiUtil.systemAlert(' ', '', false, null, null, null, 'myModal').then(function () {
                // We need to delay any attempt to launch the UWP Service Worker till after the bootstrap modal is displayed
                // or else app is left in an anomalous situation whereby it's not possible to exit the modal in some cases
                if (appstate.launchUWPServiceWorker) {
                    launchUWPServiceWorker();
                    return;
                }
                if (params.isUWPStoreApp) return; // It's a UWP app installed from the Store, so it will self update
                if (!params.allowInternetAccess) {
                    var updateServer = params.updateServer.url.replace(/^([^:]+:\/\/[^/]+).*/, '$1');
                    uiUtil.systemAlert('<p>Do you want this app to check for updates on startup?<br />(this will allow access to <i>' + updateServer + '</i>)</p>' + 
                        '<p><i>If you change your mind, use the <b>"Allow Internet Access"</b> option in Configuration to turn on or off.</i></p>'
                        , 'Updates check disabled!', true)
                    .then(function (response) {
                        if (response) document.getElementById('allowInternetAccessCheck').click();
                    });
                }
            });
            settingsStore.setItem('appVersion', params.appVersion, Infinity);
        }, 1000);
        // Show or hide sampleZIM spans
        var sampleZIM = document.getElementById('sampleZIM');
        var noSampleZIM = document.getElementById('noSampleZIM');
        if (params.packagedFile && /Electron|UWP/.test(params.appType)) {
            if (/mdwiki|wikivoyage|medicine/i.test(params.packagedFile)) {
                sampleZIM.innerHTML = 'This app is packaged with the following ZIM archive: <b>' + params.packagedFile + '</b>. Versions in many different languages are available for download.';
                noSampleZIM.style.display = 'none';
            }
            sampleZIM.style.display = 'inline';
        } else {
            sampleZIM.style.display = 'none';
            noSampleZIM.innerHTML = 'To use this app,' + noSampleZIM.innerHTML;
            noSampleZIM.style.display = 'inline';
        }
    } else if (appstate.launchUWPServiceWorker) {
        launchUWPServiceWorker();
    }
});

/**
 * Displays or refreshes the API status shown to the user
 */
function refreshAPIStatus() {
    var apiStatusPanel = document.getElementById('apiStatusDiv');
    apiStatusPanel.classList.remove('panel-success', 'panel-warning', 'panel-danger');
    var apiPanelClass = 'panel-success';
    if (isMessageChannelAvailable()) {
        $('#messageChannelStatus').html("MessageChannel API available");
        $('#messageChannelStatus').removeClass("apiAvailable apiUnavailable")
            .addClass("apiAvailable");
    } else {
        apiPanelClass = 'panel-warning';
        $('#messageChannelStatus').html("MessageChannel API unavailable");
        $('#messageChannelStatus').removeClass("apiAvailable apiUnavailable")
            .addClass("apiUnavailable");
    }
    if (isServiceWorkerAvailable()) {
        if (isServiceWorkerReady()) {
            $('#serviceWorkerStatus').html("ServiceWorker API available, and registered");
            $('#serviceWorkerStatus').removeClass("apiAvailable apiUnavailable")
                .addClass("apiAvailable");
        } else {
            apiPanelClass = 'panel-warning';
            $('#serviceWorkerStatus').html("ServiceWorker API available, but not registered");
            $('#serviceWorkerStatus').removeClass("apiAvailable apiUnavailable")
                .addClass("apiUnavailable");
        }
    } else {
        apiPanelClass = 'panel-warning';
        $('#serviceWorkerStatus').html("ServiceWorker API unavailable");
        $('#serviceWorkerStatus').removeClass("apiAvailable apiUnavailable")
            .addClass("apiUnavailable");
    }

    // Update Settings Store section of API panel with API name
    var settingsStoreStatusDiv = document.getElementById('settingsStoreStatus');
    var apiName = params.storeType === 'cookie' ? 'Cookie' : params.storeType === 'local_storage' ? 'Local Storage' : 'None';
    settingsStoreStatusDiv.innerHTML = 'Settings Storage API in use: ' + apiName;
    settingsStoreStatusDiv.classList.remove('apiAvailable', 'apiUnavailable');
    settingsStoreStatusDiv.classList.add(params.storeType === 'none' ? 'apiUnavailable' : 'apiAvailable');
    apiPanelClass = params.storeType === 'none' ? 'panel-warning' : apiPanelClass;
    
    // Update Decompressor API section of panel
    var decompAPIStatusDiv = document.getElementById('decompressorAPIStatus');
    apiName = params.decompressorAPI.assemblerMachineType;
    if (apiName && params.decompressorAPI.decompressorLastUsed) {
        apiName += ' [&nbsp;' + params.decompressorAPI.decompressorLastUsed + '&nbsp;]';
    }
    apiPanelClass = params.decompressorAPI.errorStatus ? 'panel-danger' : apiName ? apiPanelClass : 'panel-warning';
    decompAPIStatusDiv.className = apiName ? params.decompressorAPI.errorStatus ? 'apiBroken' : 'apiAvailable' : 'apiUnavailable';
    apiName = params.decompressorAPI.errorStatus || apiName || 'Not initialized';
    decompAPIStatusDiv.innerHTML = 'Decompressor API: ' + apiName;

    // Update Search Provider
    uiUtil.reportSearchProviderToAPIStatusPanel(params.searchProvider);

    // Update PWA origin
    var pwaOriginStatusDiv = document.getElementById('pwaOriginStatus');
    pwaOriginStatusDiv.className = 'apiAvailable';
    pwaOriginStatusDiv.innerHTML = 'PWA Origin: ' + window.location.origin;

    // Add a warning colour to the API Status Panel if any of the above tests failed
    apiStatusPanel.classList.add(apiPanelClass);

    // Set visibility of UI elements according to mode
    document.getElementById('bypassAppCacheDiv').style.display = params.contentInjectionMode === 'serviceworker' ? 'block' : 'none';

    // Set colour of contentInjectionMode div
    var contentInjectionDiv = document.getElementById('contentInjectionModeDiv');
    contentInjectionDiv.classList.remove('parnel-warning');
    contentInjectionDiv.classList.remove('panel-danger');
    if (params.contentInjectionMode === 'serviceworker') contentInjectionDiv.classList.add('panel-warning');
    else contentInjectionDiv.classList.add('panel-danger');

    refreshCacheStatus();
}

/** 
 * Refreshes the UI (Configuration) with the cache attributes obtained from getCacheAttributes()
 */
function refreshCacheStatus() {
    // Update radio buttons and checkbox
    document.getElementById('cachedAssetsModeRadio' + (params.assetsCache ? 'True' : 'False')).checked = true;
    // Get cache attributes, then update the UI with the obtained data
    cache.count(function (c) {
        document.getElementById('cacheUsed').innerHTML = c.description;
        document.getElementById('assetsCount').innerHTML = c.count;
        var cacheSettings = document.getElementById('performanceSettingsDiv');
        var cacheStatusPanel = document.getElementById('cacheStatusPanel');
        [cacheSettings, cacheStatusPanel].forEach(function (card) {
            // IE11 cannot remove more than one class from a list at a time
            card.classList.remove('panel-warning');
            card.classList.remove('panel-danger');
            if (params.assetsCache) card.classList.add('panel-warning');
            else card.classList.add('panel-danger');
        });
    });
    var scrollbox = document.getElementById('scrollbox');
    var prefix = document.getElementById('prefix');
    if (params.appCache) {
        scrollbox.style.removeProperty('background');
        prefix.style.removeProperty('background');
    } else {
        scrollbox.style.background = /^dark/.test(document.body.className) ? '#300000' : 'mistyrose';
        prefix.style.setProperty('background', /^dark/.test(document.body.className) ? '#200000' : 'lavenderblush', 'important');
    }
    var expertSettings = document.getElementById('expertSettingsDiv');
    expertSettings.classList.remove('panel-warning');
    expertSettings.classList.remove('panel-danger');
    if (!params.appCache || params.hideActiveContentWarning || params.debugLibzimASM) {
        expertSettings.classList.add('panel-danger');
    } else {
        expertSettings.classList.add('panel-warning');
    }
}

var keepAliveServiceWorkerHandle = null;
var serviceWorkerRegistration = null;

/**
 * Send an 'init' message to the ServiceWorker with a new MessageChannel
 * to initialize it, or to keep it alive.
 * This MessageChannel allows a 2-way communication between the ServiceWorker
 * and the application
 */
function initOrKeepAliveServiceWorker() {
    var delay = DELAY_BETWEEN_KEEPALIVE_SERVICEWORKER;
    if (params.contentInjectionMode === 'serviceworker') {
        // Create a new messageChannel
        var tmpMessageChannel = new MessageChannel();
        tmpMessageChannel.port1.onmessage = handleMessageChannelMessage;
        // Send the init message to the ServiceWorker, with this MessageChannel as a parameter
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                'action': 'init'
            }, [tmpMessageChannel.port2]);
        } else if (keepAliveServiceWorkerHandle) {
            console.error('The Service Worker is active but is not controlling the current page! We have to reload.');
            // Turn off failsafe, as this is a controlled reboot
            settingsStore.setItem('lastPageLoad', 'rebooting', Infinity);
            window.location.reload();
        } else {
            // If this is the first time we are initiating the SW, allow Promises to complete by delaying potential reload till next tick
            console.debug('The Service Worker needs more time to load...');
            delay = 0;
        }
        // Schedule to do it again regularly to keep the 2-way communication alive.
        // See https://github.com/kiwix/kiwix-js/issues/145 to understand why
        clearTimeout(keepAliveServiceWorkerHandle);
        keepAliveServiceWorkerHandle = setTimeout(initOrKeepAliveServiceWorker, delay, false);
    }
}

/**
 * Sets the given injection mode.
 * This involves registering (or re-enabling) the Service Worker if necessary
 * It also refreshes the API status for the user afterwards.
 * 
 * @param {String} value The chosen content injection mode : 'jquery' or 'serviceworker'
 */
function setContentInjectionMode(value) {
    params.contentInjectionMode = value;
    if (value === 'jquery') {
        // Because the Service Worker must still run in a PWA app so that it can work offline, we don't actually disable the SW in this context,
        // but it will no longer be intercepting requests for ZIM assets (only requests for the app's own code)
        if ('serviceWorker' in navigator) {
            serviceWorkerRegistration = null;
        }
        // User has switched to jQuery mode, so no longer needs ASSETS_CACHE
        // We should empty it and turn it off to prevent unnecessary space usage
        if ('caches' in window && isMessageChannelAvailable()) {
            if (isServiceWorkerAvailable() && navigator.serviceWorker.controller) {
                var channel = new MessageChannel();
                navigator.serviceWorker.controller.postMessage({
                    'action': { 'assetsCache': 'disable' }
                }, [channel.port2]);
                var channel2 = new MessageChannel();
                navigator.serviceWorker.controller.postMessage({
                    'action': 'disable'
                }, [channel2.port2]);
            }
            caches.delete(cache.ASSETS_CACHE);
        }
        refreshAPIStatus();
    } else if (value === 'serviceworker') {
        if (!isServiceWorkerAvailable()) {
            uiUtil.systemAlert("The ServiceWorker API is not available on your device. Falling back to JQuery mode").then(function () {
                setContentInjectionMode('jquery');
            });
            return;
        }
        if (!isMessageChannelAvailable()) {
            uiUtil.systemAlert("The MessageChannel API is not available on your device. Falling back to JQuery mode").then(function () {
                setContentInjectionMode('jquery');
            });
            return;
        }
        if (window.nw && nw.process.versions.nw === '0.14.7') {
            uiUtil.systemAlert('Service Worker mode is not available in the XP version of this app, due to the age of the Chromium build. Falling back to JQuery mode...')
            .then(function () {
                setContentInjectionMode('jquery');
            });
            return;
        }
        if (!isServiceWorkerReady()) {
            var serviceWorkerStatus = document.getElementById('serviceWorkerStatus');
            serviceWorkerStatus.textContent = 'ServiceWorker API available : trying to register it...';
            if (navigator.serviceWorker.controller) {
                console.log("Active Service Worker found, no need to register");
                serviceWorkerRegistration = true;
                // Remove any jQuery hooks from a previous jQuery session
                $('#articleContent').contents().remove();
                // Create the MessageChannel and send 'init'
                initOrKeepAliveServiceWorker();
                refreshAPIStatus();
            } else {
                navigator.serviceWorker.register('../service-worker.js').then(function (reg) {
                    // The ServiceWorker is registered
                    console.log('Service worker is registered with a scope of ' + reg.scope);
                    serviceWorkerRegistration = reg;
                    // We need to wait for the ServiceWorker to be activated
                    // before sending the first init message
                    var serviceWorker = reg.installing || reg.waiting || reg.active;
                    serviceWorker.addEventListener('statechange', function (statechangeevent) {
                        if (statechangeevent.target.state === 'activated') {
                            // Remove any jQuery hooks from a previous jQuery session
                            $('#articleContent').contents().remove();
                            // Create the MessageChannel and send the 'init' message to the ServiceWorker
                            initOrKeepAliveServiceWorker();
                            // We need to refresh cache status here on first activation because SW was inaccessible till now
                            // We also initialize the ASSETS_CACHE constant in SW here
                            refreshCacheStatus();
                            setWindowOpenerUI();
                            refreshAPIStatus();
                        }
                    });
                    if (serviceWorker.state === 'activated') {
                        // Even if the ServiceWorker is already activated,
                        // We need to re-create the MessageChannel
                        // and send the 'init' message to the ServiceWorker
                        // in case it has been stopped and lost its context
                        initOrKeepAliveServiceWorker();
                    }
                    refreshAPIStatus();
                }).catch(function (err) {
                    console.error('Error while registering serviceWorker', err);
                    refreshAPIStatus();
                    var message = "The ServiceWorker could not be properly registered. Switching back to jQuery mode. Error message : " + err;
                    var protocol = window.location.protocol;
                    if (protocol === 'ms-appx-web:') {
                        // We can't launch straight away if the app is starting, because the large modal could be showing
                        if (params.appIsLaunching) {
                            appstate.launchUWPServiceWorker = true;
                        } else {
                            launchUWPServiceWorker();
                        }
                        message = "";
                    } else if (protocol === 'moz-extension:') {
                        message += "\n\nYou seem to be using kiwix-js through a Firefox extension : ServiceWorkers are disabled by Mozilla in extensions.";
                        message += "\nPlease vote for https://bugzilla.mozilla.org/show_bug.cgi?id=1344561 so that some future Firefox versions support it";
                    } else if (protocol === 'file:') {
                        message += "\n\nYou seem to be opening kiwix-js with the file:// protocol. You should open it through a web server : either through a local one (http://localhost/...) or through a remote one (but you need SSL : https://webserver/...)";
                    }
                    if (message) uiUtil.systemAlert(message, 'Information');
                    setContentInjectionMode("jquery");
                });
            }
        } else {
            // We need to set this variable earlier else the Service Worker does not get reactivated
            params.contentInjectionMode = value;
            initOrKeepAliveServiceWorker();
        }
    }
    $('input:radio[name=contentInjectionMode]').prop('checked', false);
    $('input:radio[name=contentInjectionMode]').filter('[value="' + value + '"]').prop('checked', true);
    params.contentInjectionMode = value;
    // Save the value in a cookie, so that to be able to keep it after a reload/restart
    settingsStore.setItem('contentInjectionMode', value, Infinity);
    setWindowOpenerUI();
}

// At launch, we try to set the last content injection mode (stored in Settings Store)
setContentInjectionMode(params.contentInjectionMode);
// var contentInjectionMode = settingsStore.getItem('contentInjectionMode');
// if (contentInjectionMode) {
//     setContentInjectionMode(contentInjectionMode);
// } else {
//     setContentInjectionMode('jquery');
// }

/**
 * Tells if the ServiceWorker API is available
 * https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker
 * @returns {Boolean}
 */
function isServiceWorkerAvailable() {
    return 'serviceWorker' in navigator;
}

/**
 * Tells if the MessageChannel API is available
 * https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel
 * @returns {Boolean}
 */
function isMessageChannelAvailable() {
    try {
        var dummyMessageChannel = new MessageChannel();
        if (dummyMessageChannel) return true;
    } catch (e) {
        return false;
    }
    return false;
}

/**
 * Tells if the ServiceWorker is registered, and ready to capture HTTP requests
 * and inject content in articles.
 * @returns {Boolean}
 */
function isServiceWorkerReady() {
    // Return true if the serviceWorkerRegistration is not null and not undefined
    return serviceWorkerRegistration;
}

function launchUWPServiceWorker () {
    delete appstate.launchUWPServiceWorker;
    var message = '<p>To enable the Service Worker, we need one-time access to our secure server ' +
        'so that the app can re-launch as a Progressive Web App (PWA).</p>' +
        '<p>The PWA will be able to run offline, but will auto-update periodically when online ' +
        'as per the Service Worker spec.</p>' +
        '<p>You can switch back any time by toggling <i>Allow Internet access?</i> off.</p>' +
        '<p><b>WARNING:</b> This will attempt to access the following server: <i>' + params.PWAServer + '</i></p>' +
        '<p><b>*** Screen may flash between black and white. ***</b></p>' +
        '<p>Note: If the app crashes, simply relaunch it.</p>';
    var launchPWA = function () {
        settingsStore.setItem('contentInjectionMode', 'serviceworker', Infinity);
        // This is needed so that we get passthrough on subsequent launches
        settingsStore.setItem('allowInternetAccess', true, Infinity);
        var uriParams = '?allowInternetAccess=true';
        // We are using allowInternetAccess as a passthrough, so we don't force a switch to SW mode on the server
        // except on first launch of SW mode
        uriParams += params.allowInternetAccess ? '' : '&contentInjectionMode=serviceworker';
        uriParams += '&manipulateImages=false&allowHTMLExtraction=false';
        // Commented line below causes crash if there are too many archives
        // uriParams += '&listOfArchives=' + encodeURIComponent(settingsStore.getItem('listOfArchives'));
        uriParams += '&lastSelectedArchive=' + encodeURIComponent(params.storedFile);
        // DEV: Line below causes crash when switching to SW mode in UWP app!
        // uriParams += '&lastPageVisit=' + encodeURIComponent(params.lastPageVisit);
        uriParams += params.packagedFile ? '&packagedFile=' + encodeURIComponent(params.packagedFile) : '';
        uriParams += params.fileVersion ? '&fileVersion=' + encodeURIComponent(params.fileVersion) : '';
        // Signal failure of PWA until it has successfully launched (in init.js it will be changed to 'success')
        params.localUWPSettings.PWA_launch = 'fail';
        window.location.href = params.PWAServer + 'www/index.html' + uriParams;
        // throw 'Beam me up, Scotty!';
    };
    var checkPWAIsOnline = function () {
        uiUtil.checkServerIsAccessible(params.PWAServer + 'www/img/icons/kiwix-32.png', launchPWA, function () {
            uiUtil.systemAlert('<p>The server is not currently accessible!</p>' +
                '<p>(Kiwix needs one-time access to the server to cache the PWA).</p>' +
                '<p>Please try again when you have a stable Internet connection.</p>', 'Error!');
        });
    };
    if (settingsStore.getItem('allowInternetAccess') === 'true' && params.localUWPSettings.PWA_launch && params.localUWPSettings.PWA_launch !== 'fail') {
        if (params.localUWPSettings.PWA_launch === 'success') launchPWA();
        else checkPWAIsOnline();
        return;
    } else {
        if (params.localUWPSettings.PWA_launch === 'fail') {
            message = '<p>The PWA MAY have failed to launch on the last attempt ' +
                '(we show this information to prevent a boot loop).</p>' +
                '<p>Please try again by selecting "Access server":</p>';
        }
        uiUtil.systemAlert(message, 'Information', true, 'Cancel', 'Access server').then(function (confirm) {
            if (confirm) launchPWA();
            else {
                var allowAccessCheck = document.getElementById('allowInternetAccessCheck');
                if (allowAccessCheck.checked) allowAccessCheck.click();
            }
        });
    }
}

/**
 * 
 * @type Array.<StorageFirefoxOS>
 */
var storages = [];

function searchForArchivesInPreferencesOrStorage() {
    // First see if the list of archives is stored in the cookie
    var listOfArchivesFromCookie = settingsStore.getItem("listOfArchives");
    if (listOfArchivesFromCookie !== null && listOfArchivesFromCookie !== undefined && listOfArchivesFromCookie !== "") {
        var directories = listOfArchivesFromCookie.split('|');
        populateDropDownListOfArchives(directories);
    } else {
        if (storages.length || params.localStorage) {
            searchForArchivesInStorage();
        } else {
            displayFileSelect();
            if (document.getElementById('archiveFiles').files && document.getElementById('archiveFiles').files.length > 0) {
                // Archive files are already selected, 
                setLocalArchiveFromFileSelect();
            } else {
                var btnConfigure = document.getElementById('btnConfigure');
                if (!btnConfigure.classList.contains('active')) btnConfigure.click();
            }
        }
    }
}

function searchForArchivesInStorage() {
    // If DeviceStorage is available, we look for archives in it
    document.getElementById('btnConfigure').click();
    document.getElementById('scanningForArchives').style.display = '';
    if (params.localStorage && typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined') {
        scanUWPFolderforArchives(params.localStorage);
    } else {
        zimArchiveLoader.scanForArchives(storages, populateDropDownListOfArchives, function () {
            // callbackError function is called in case of an error
            uiUtil.systemAlert(message, label).then(populateDropDownListOfArchives(null));
        });
    }
}

if ('launchQueue' in window && 'files' in LaunchParams.prototype) {
    console.log('File Handling API is available');
    launchQueue.setConsumer(function (launchParams) {
        // Nothing to do when the queue is empty.
        if (!launchParams.files.length) {
            console.debug('Launch Queue is empty');
        } else {
            // User launched app by double-clicking on file
            console.debug('Processing NativeFileHandle for ' + launchParams);
            processNativeFileHandle(launchParams.files[0]);
        }
    });
}

// @STORAGE AUTOLOAD STARTS HERE
if ($.isFunction(navigator.getDeviceStorages)) {
    // The method getDeviceStorages is available (FxOS>=1.1)
    storages = $.map(navigator.getDeviceStorages("sdcard"), function (s) {
        return new abstractFilesystemAccess.StorageFirefoxOS(s);
    });
}
if (storages !== null && storages.length > 0 ||
    typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined' ||
    typeof window.fs !== 'undefined' || typeof window.showOpenFilePicker === 'function') {
    if (window.fs && !(params.pickedFile || params.pickedFolder)) {
        // Below we compare the prefix of the files, i.e. the generic filename without date, so we can smoothly deal with upgrades
        if (params.packagedFile && params.storedFile.replace(/(^[^-]+all).+/, '$1') === params.packagedFile.replace(/(^[^-]+all).+/, '$1')) {
            // We're in Electron / NWJS and we need to load the packaged app, so we are forced to use the .fs code
            params.pickedFile = params.packagedFile;
            params.storedFile = params.packagedFile;
        } else if (!params.storedFile) {
            // If there is no last selected archive, we need to use the .fs code anyway
            params.pickedFile = params.packagedFile;
        } else if (/\/archives\//.test(params.storedFilePath) && ~params.storedFilePath.indexOf(params.storedFile)) {
            // We're in an Electron / NWJS app, and there is a stored file in the archive, but it's not the packaged archive!
            // Probably there is more than one archive in the archive folder, so we are forced to use .fs code
            console.warn("There may be more than one archive in the directory " + params.storedFilePath.replace(/[^\/]+$/, ''));
            params.pickedFile = params.storedFile;
        }
    }
    if (!params.pickedFile) {
        if (params.storedFile && window.showOpenFilePicker) {
            // We are in an app with support for File System Access API, so we can't auto-load the file, show file pickers
            document.getElementById('btnConfigure').click();
        } else {
            searchForArchivesInPreferencesOrStorage();
        }
    } else if (typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined') {
        console.log("Loading picked file for UWP app...");
        processPickedFileUWP(params.pickedFile);
    // } else if (launchArguments && 'launchQueue' in window) {
    //     // The app was launched with a file
    //     processNativeFileHandle(params.pickedFile); 
    } else {
        // @AUTOLOAD packaged archive in Electron and NWJS packaged apps
        // We need to read the packaged file using the node File System API (so user doesn't need to pick it on startup)
        console.log("Loading packaged ZIM or last selected archive for Electron or NWJS...");
        // If we're in an AppImage package and the storedFilePath points to the packaged archive, then the storedFilePath will be invalid,
        // because a new path is established each time the image's filesystem is mounted. So we reset to default.
        var archiveFilePath = params.storedFilePath;
        if (params.storedFile === params.packagedFile) {
            // If the app is packed inside an asar archive, we need to alter the archivePath to point outside the asar directory
            if (/\/app.asar\//.test(document.location.href) && !/^\.\.[\\/]/.test(params.archivePath)) params.archivePath = '../' + params.archivePath;
            archiveFilePath = params.archivePath + '/' + params.packagedFile;
            if (~params.storedFilePath.indexOf(archiveFilePath)) {
                params.storedFilePath = archiveFilePath;
            }
        }
        var archiveDirectory = archiveFilePath.replace(/[\\/][^\\/]+$/, '');
        readNodeDirectoryAndCreateNodeFileObjects(archiveDirectory, params.storedFile).then(function (archiveFiles) {
            var pickedFileset = archiveFiles[0], archivesInFolder = archiveFiles[1];
            params.pickedFolder = archiveDirectory;
            params.pickedfile = '';
            setLocalArchiveFromFileList(pickedFileset);
            if (!params.rescan) populateDropDownListOfArchives(archivesInFolder, true);
            document.getElementById('hideFileSelectors').style.display = params.showFileSelectors ? 'inline' : 'none';
        }).catch(function (err) {
            console.error('There was an error reading the directory!', err);
            // Attempts to load the file seem to have failed: maybe it has moved or been deleted
            // Let's see if we can open the packaged ZIM instead (if this isn't the packaged ZIM)
            settingsStore.removeItem('lastSelectedArchive');
            settingsStore.removeItem('lastSelectedArchivePath');
            if (params.packagedFile && params.storedFile !== params.packagedFile) {
                createFakeFileObjectNode(params.packagedFile, params.archivePath + '/' + params.packagedFile, function (fakeFileList) {
                    var fakeFile = fakeFileList[0];
                    if (fakeFile && fakeFile.size) {
                        params.pickedFile = fakeFile;
                        setLocalArchiveFromFileList([params.pickedFile]);
                    } else {
                        // This shouldn't happen!
                        params.showFileSelectors = true;
                        document.getElementById('hideFileSelectors').style.display = 'inline';
                        document.getElementById('btnConfigure').click();
                        setTimeout(function () {
                            uiUtil.systemAlert('The packaged file cannot be loaded!\nPlease check that it is in the "' + params.archivePath + '" folder\nor pick a new ZIM file.');
                        }, 10);
                    }
                });
            } else {
                params.showFileSelectors = true;
                document.getElementById('hideFileSelectors').style.display = 'inline';
                document.getElementById('btnConfigure').click();
                var message = params.packagedFile ? ('The packaged file cannot be found!\nPlease check that it is in the "' + params.archivePath + 
                    '" folder\nor pick a new ZIM file.') : 'The previously picked file cannot be found!\nPlease pick a new ZIM file.'
                setTimeout(function () {
                    uiUtil.systemAlert(message);
                }, 10);
            }

        });
        document.getElementById('hideFileSelectors').style.display = params.showFileSelectors ? 'inline' : 'none';
    }
} else {
    // If DeviceStorage is not available, we display the file select components
    displayFileSelect();
    if (document.getElementById('archiveFiles').files && document.getElementById('archiveFiles').files.length > 0) {
        // Archive files are already selected, 
        setLocalArchiveFromFileSelect();
    } else {
        document.getElementById('btnConfigure').click();
    }
}

// Display the article when the user goes back in the browser history
var historyPop = function(event) {
    if (event.state) {
        var title = event.state.title;
        var titleSearch = event.state.titleSearch;
        appstate.target = event.target.kiwixType;
        // Select the correct window to which to write the popped history in case the user
        // siwtches to a tab and navigates history without first clicking on a link
        if (appstate.target === 'window') articleWindow = event.target;
        $('#prefix').val("");
        document.getElementById('welcomeText').style.display = 'none';
        uiUtil.clearSpinner();
        document.getElementById('configuration').style.display = 'none';
        document.getElementById('articleListWithHeader').style.display = 'none';
        let articleContent = document.getElementById('articleContent');
        let articleContentDoc = articleContent ? articleContent.contentDocument : null;
        while (articleContentDoc.firstChild) articleContentDoc.removeChild(articleContentDoc.firstChild);
        if (title && !("" === title)) {
            goToArticle(title);
        }
        else if (titleSearch && titleSearch !== '') {
            $('#prefix').val(titleSearch);
            if (titleSearch !== appstate.search.prefix) {
                searchDirEntriesFromPrefix(titleSearch);
            } else {
                document.getElementById('prefix').focus();
            }
        }
    }
};

window.onpopstate = historyPop;

/**
 * Populate the drop-down list of archives with the given list
 * @param {Array.<String>} archiveDirectories
 */
function populateDropDownListOfArchives(archiveDirectories, displayOnly) {
    document.getElementById('scanningForArchives').style.display = 'none';
    document.getElementById('chooseArchiveFromLocalStorage').style.display = '';
    document.getElementById('rescanStorage').style.display = params.rescan ? 'none' : 'block';
    document.getElementById('openLocalFiles').style.display = params.rescan ? "block" : "none";
    // Hide instructions now user has selected a folder, unless the packaged archive is still loaded
    if (appstate.selectedArchive && appstate.selectedArchive._file && !~params.packagedFile.indexOf(appstate.selectedArchive._file.name)) {
        document.getElementById('UWPInstructions').style.display = 'none';
    }
    var plural = 's';
    plural = archiveDirectories.length === 1 ? '' : plural;
    document.getElementById('archiveNumber').innerHTML = '<b>' + archiveDirectories.length + '</b> Archive' + plural + ' found in selected location (tap "Select storage" to change)';
    var comboArchiveList = document.getElementById('archiveList');
    var usage = document.getElementById('usage');
    comboArchiveList.options.length = 0;
    for (var i = 0; i < archiveDirectories.length; i++) {
        var archiveDirectory = archiveDirectories[i];
        if (archiveDirectory === "/") {
            uiUtil.systemAlert("It looks like you have put some archive files at the root of your sdcard (or internal storage). Please move them in a subdirectory");
        } else {
            comboArchiveList.options[i] = new Option(archiveDirectory, archiveDirectory);
        }
    }
    // Store the list of archives in a cookie, to avoid rescanning at each start
    settingsStore.setItem("listOfArchives", archiveDirectories.join('|'), Infinity);
    comboArchiveList.size = comboArchiveList.length > 15 ? 15 : comboArchiveList.length;
    //Kiwix-Js-Windows #23 - remove dropdown caret if only one archive
    if (comboArchiveList.length > 1) comboArchiveList.removeAttribute("multiple");
    if (comboArchiveList.length == 1) comboArchiveList.setAttribute("multiple", "1");
    if (comboArchiveList.options.length > 0) {
        // If we're doing a rescan, then don't attempt to jump to the last selected archive, but leave selectors open
        var lastSelectedArchive = params.rescan ? '' : params.storedFile;
        if (lastSelectedArchive !== null && lastSelectedArchive !== undefined && lastSelectedArchive !== "") {
            //  || comboArchiveList.options.length == 1
            // Either we have previously chosen a file, or there is only one file
            // Attempt to select the corresponding item in the list, if it exists
            var success = false;
            if ($("#archiveList option[value='" + lastSelectedArchive + "']").length > 0) {
                $("#archiveList").val(lastSelectedArchive);
                success = true;
                settingsStore.setItem("lastSelectedArchive", lastSelectedArchive, Infinity);
            }
            // Set the localArchive as the last selected (if none has been selected previously, wait for user input)
            if (success) {
                if (!displayOnly) setLocalArchiveFromArchiveList(lastSelectedArchive);
            } else {
                // We can't find lastSelectedArchive in the archive list
                // Let's first check if this is a Store UWP/PWA that has a different archive package from that last selected
                // (or from that indicated in init.js)
                if (typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined' && 
                    params.packagedFile && settingsStore.getItem('lastSelectedArchive') !== params.packagedFile) {
                    // We didn't pick this file previously, so select first one in list
                    params.storedFile = archiveDirectories[0];
                    params.fileVersion = ~params.fileVersion.indexOf(params.storedFile.replace(/\.zim\w?\w?$/i, '')) ? params.fileVersion : params.storedFile;
                    setLocalArchiveFromArchiveList(params.storedFile);
                } else {
                    // It's genuinely no longer available, so let's ask the user to pick it
                    var message = '<p>We could not find the archive <b>' + lastSelectedArchive + '</b>!</p><p>Please select its location...</p>';
                    if (typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined')
                        message += '<p><i>Note:</i> If you drag-drop an archive into this UWP app, then it will have to be dragged again each time you launch the app. Try double-clicking on the archive instead, or select it using the controls on this page.</p>';
                    if (document.getElementById('configuration').style.display == 'none') {
                        document.getElementById('btnConfigure').click();
                    }
                    uiUtil.systemAlert(message).then(function () {
                        displayFileSelect();
                    });
                }
            }
        }
        usage.style.display = 'none';
    } else {
        usage.style.display = 'block';
    }
}

/**
 * Sets the localArchive from the selected archive in the drop-down list
 */
function setLocalArchiveFromArchiveList(archive) {
    params.rescan = false;
    archive = archive || $('#archiveList').val();
    if (archive && archive.length > 0) {
        // Now, try to find which DeviceStorage has been selected by the user
        // It is the prefix of the archive directory
        var regexpStorageName = /^\/([^\/]+)\//;
        var regexpResults = regexpStorageName.exec(archive);
        var selectedStorage = null;
        if (regexpResults && regexpResults.length > 0) {
            var selectedStorageName = regexpResults[1];
            for (var i = 0; i < storages.length; i++) {
                var storage = storages[i];
                if (selectedStorageName === storage.storageName) {
                    // We found the selected storage
                    selectedStorage = storage;
                }
            }
            if (selectedStorage === null) {
                uiUtil.systemAlert("Unable to find which device storage corresponds to archive " + archive);
            }
        } else {
            // This happens when the archive is not prefixed by the name of the storage
            // (in the Simulator, or with FxOs 1.0, or probably on devices that only have one device storage)
            // In this case, we use the first storage of the list (there should be only one)
            if (storages.length === 1) {
                selectedStorage = storages[0];
            } else { //IT'S NOT FREAKIN FFOS!!!!!!!!!!
                //Patched for UWP support:
                if (!params.pickedFile && params.pickedFolder && typeof MSApp !== 'undefined') {
                    var query = params.pickedFolder.createFileQuery();
                    query.getFilesAsync().done(function (files) {
                        var file;
                        var fileset = [];
                        if (files) {
                            for (var i = 0; i < files.length; i++) {
                                if (files[i].name == archive) {
                                    file = files[i];
                                    break;
                                }
                            }
                            if (file) {
                                if (/\.zim\w\w$/i.test(file.name)) {
                                    var genericFileName = file.name.replace(/(\.zim)\w\w$/i, '$1');
                                    var testFileName = new RegExp(genericFileName + '\\w\\w$');
                                    for (i = 0; i < files.length; i++) {
                                        if (testFileName.test(files[i].name)) {
                                            //This converts a UWP storage file object into a standard JavaScript web file object
                                            fileset.push(MSApp.createFileFromStorageFile(files[i]));
                                        }
                                    }
                                } else {
                                    //This converts a UWP storage file object into a standard JavaScript web file object
                                    fileset.push(MSApp.createFileFromStorageFile(file));
                                }
                            }
                        }
                        if (fileset.length) {
                            setLocalArchiveFromFileList(fileset);
                        } else {
                            console.error("The picked file could not be found in the selected folder!\n" + params.pickedFile);
                            var archiveList = [];
                            for (i = 0; i < files.length; i++) {
                                if (/\.zim(aa)?$/i.test(files[i].name)) {
                                    archiveList.push(files[i].name);
                                }
                            }
                            populateDropDownListOfArchives(archiveList);
                            document.getElementById('btnConfigure').click();
                        }
                    });
                    return;
                } else if (!params.pickedFile && params.pickedFolder && params.pickedFolder.kind) {
                    // Native FS support
                    return cache.verifyPermission(params.pickedFolder).then(function (permission) {
                        if (!permission) {
                            console.log('User denied permission to access the folder');
                            openCurrentArchive.style.display = 'inline';
                            return;
                        } else if (params.pickedFolder.kind === 'directory') {
                            return processNativeDirHandle(params.pickedFolder, function(fileHandles) {
                                var fileHandle;
                                var fileset = [];
                                if (fileHandles) {
                                    for (var i = 0; i < fileHandles.length; i++) {
                                        if (fileHandles[i].name == archive) {
                                            fileHandle = fileHandles[i];
                                            break;
                                        }
                                    }
                                    if (fileHandle) {
                                        // Deal with split archives
                                        if (/\.zim\w\w$/i.test(fileHandle.name)) {
                                            var genericFileName = fileHandle.name.replace(/(\.zim)\w\w$/i, '$1');
                                            var testFileName = new RegExp(genericFileName + '\\w\\w$');
                                            for (i = 0; i < fileHandles.length; i++) {
                                                if (testFileName.test(fileHandles[i].name)) {
                                                    //This gets a JS File object from a file handle
                                                    fileset.push(fileHandles[i].getFile().then(function(file) {
                                                        return file;
                                                    }));
                                                }
                                            }
                                        } else {
                                            // Deal with single unslpit archive
                                            fileset.push(fileHandle.getFile().then(function(file) {
                                                return file;
                                            }));
                                        }
                                        if (fileset.length) {
                                            // Wait for all getFile Promises to resolve
                                            Promise.all(fileset).then(function (resolvedFiles) {
                                                setLocalArchiveFromFileList(resolvedFiles);
                                            });
                                        } else {
                                            console.error("There was an error reading the picked file(s)!");
                                        }
                                    } else {
                                        console.error("The picked file could not be found in the selected folder!");
                                        var archiveList = [];
                                        for (i = 0; i < fileHandles.length; i++) {
                                            if (/\.zim(aa)?$/i.test(fileHandles[i].name)) {
                                                archiveList.push(fileHandles[i].name);
                                            }
                                        }
                                        populateDropDownListOfArchives(archiveList);
                                        document.getElementById('btnConfigure').click();
                                    }
                                } else {
                                    console.log('There was an error obtaining the file handle(s).');
                                }
                            });
                        }
                        openCurrentArchive.style.display = 'none';
                    }).catch(function () {
                        openCurrentArchive.style.display = 'inline';
                    });
                    return;
                } else if (window.fs) {
                    if (params.pickedFile) {
                        setLocalArchiveFromFileList([params.pickedFile]);
                    } else {
                        if (params.pickedFolder) {
                            readNodeDirectoryAndCreateNodeFileObjects(params.pickedFolder, archive)
                            .then(function (fileset) {
                                var selectedFiles = fileset[0];
                                if (appstate.selectedArchive && appstate.selectedArchive._file._files[0].name === selectedFiles[0].name) {
                                    document.getElementById('btnHome').click();
                                } else {
                                    setLocalArchiveFromFileList(selectedFiles);
                                }
                            });
                        } else {
                            uiUtil.systemAlert('We could not find the location of the file ' + archive + 
                                '. This can happen if you dragged and dropped a file into the app. Please use the file or folder pickers instead.');
                            if (document.getElementById('configuration').style.display == 'none')
                                document.getElementById('btnConfigure').click();
                            displayFileSelect();
                        }
                    }
                    return;
                } else { //Check if user previously picked a specific file rather than a folder
                    if (params.pickedFile && typeof MSApp !== 'undefined') {
                        try {
                            selectedStorage = MSApp.createFileFromStorageFile(params.pickedFile);
                            setLocalArchiveFromFileList([selectedStorage]);
                            return;
                        } catch (err) {
                            // Probably user has moved or deleted the previously selected file
                            uiUtil.systemAlert("The previously picked archive can no longer be found!");
                            console.error("Picked archive not found: " + err);
                        }
                    } else if (params.pickedFile && typeof window.showOpenFilePicker === 'function') {
                        // Native FS API for single file
                        setLocalArchiveFromFileList([params.pickedFile]);
                        return;
                    }
                }
                //There was no picked file or folder, so we'll try setting the default localStorage
                //if (!params.pickedFolder) {
                //This gets called, for example, if the picked folder or picked file are in FutureAccessList but now are
                //no longer accessible. There will be a (handled) error in cosole log, and params.pickedFolder and params.pickedFile will be blank
                params.rescan = true;
                if (params.localStorage) {
                    scanUWPFolderforArchives(params.localStorage);
                } else {
                    var btnConfigure = document.getElementById('btnConfigure');
                    if (!btnConfigure.classList.contains('active')) btnConfigure.click();
                }
                return;
                //}
            }
        }
        // Reset the cssDirEntryCache and cssBlobCache. Must be done when archive changes.
        if (cssBlobCache)
            cssBlobCache = new Map();
        //if (cssDirEntryCache)
        //    cssDirEntryCache = new Map();
        appstate.selectedArchive = zimArchiveLoader.loadArchiveFromDeviceStorage(selectedStorage, archive, function (archive) {
            settingsStore.setItem("lastSelectedArchive", archive, Infinity);
            // Ensure that the new ZIM output is initially sent to the iframe (e.g. if the last article was loaded in a window)
            // (this only affects jQuery mode)
            appstate.target = 'iframe';
            appstate.wikimediaZimLoaded = appstate.selectedArchive && /wikipedia|wikivoyage|mdwiki|wiktionary/i.test(appstate.selectedArchive._file.name);
            if (params.contentInjectionMode === 'serviceworker') {
                if (!appstate.wikimediaZimLoaded) {
                    if (params.manipulateImages) document.getElementById('manipulateImagesCheck').click();
                    if (settingsStore.getItem('displayHiddenBlockeElements') === 'auto') params.displayHiddenBlockElements = false;
                    if (params.allowHTMLExtraction) document.getElementById('allowHTMLExtractionCheck').click();
                    // Set defaults that allow for greatest compabitibility with Zimit ZIM types
                    if (params.zimType === 'zimit') {
                        var determinedTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssTheme;
                        if (params.cssTheme === 'auto' && determinedTheme !== 'light' && !/UWP/.test(params.appType)) {
                            params.cssTheme = 'darkReader';
                            document.getElementById('cssWikiDarkThemeDarkReaderCheck').checked = true;
                        }
                        if (!params.windowOpener) {
                            params.noWarning = true;
                            document.getElementById('tabOpenerCheck').click();
                            params.noWarning = false;
                        }
                    }
                } else {
                    params.noWarning = true;
                    if (!params.manipulateImages) document.getElementById('manipulateImagesCheck').click();
                    if (settingsStore.getItem('displayHiddenBlockeElements') === 'auto') params.displayHiddenBlockElements = 'auto';
                    params.noWarning = false;
                    params.cssTheme = settingsStore.getItem('cssTheme') || 'light';
                    if (params.cssTheme === 'auto') {
                        document.getElementById('cssWikiDarkThemeDarkReaderCheck').checked = false;
                    }
                }
            }
            // The archive is set : go back to home page to start searching
            if (params.rescan) {
                document.getElementById('btnConfigure').click();
                params.rescan = false;
            } else {
                document.getElementById('openLocalFiles').style.display = 'none';
                document.getElementById('rescanStorage').style.display = 'block';
                document.getElementById('usage').style.display = 'none';
                document.getElementById('btnHome').click();
            }
        }, function (message, label) {
            // callbackError which is called in case of an error
            uiUtil.systemAlert(message, label);
        });
    }
}

if (!params.disableDragAndDrop) {
    // Define globalDropZone (universal drop area) and configDropZone (highlighting area on Config page)
    var globalDropZone = document.getElementById('search-article');
    var configDropZone = document.getElementById('configuration');

    // Set the main drop zone
    globalDropZone.addEventListener('dragover', handleGlobalDragover);
    globalDropZone.addEventListener('drop', handleFileDrop);
    configDropZone.addEventListener('dragleave', function (e) {
        configDropZone.style.border = '';
    });
}

/**
 * Displays the zone to select files from the archive
 */
function displayFileSelect() {
    document.getElementById('openLocalFiles').style.display = 'block';
    // Remove instructions if user has already loaded an archive, and it isn't the packaged archive
    var UWPInstructions = document.getElementById('UWPInstructions');
    if (appstate.selectedArchive) {
        UWPInstructions.style.display = ~params.packagedFile.indexOf(appstate.selectedArchive._file.name) ? 'block' : 'none';
    } else {
        UWPInstructions.style.display = 'block';
    }
    document.getElementById('rescanStorage').style.display = 'none';
    // This handles use of the file picker
    document.getElementById('archiveFiles').addEventListener('change', setLocalArchiveFromFileSelect);
}

function handleGlobalDragover(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    if (configDropZone.style.display === 'none') document.getElementById('btnConfigure').click();
    configDropZone.style.border = '3px dotted red';
}

function handleIframeDragover(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    document.getElementById('btnConfigure').click();
}

function handleIframeDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    return;
}

function handleFileDrop(packet) {
    packet.stopPropagation();
    packet.preventDefault();
    configDropZone.style.border = '';
    var items = packet.dataTransfer.items;
    if (items && items.length === 1 && items[0].kind === 'file' && typeof items[0].getAsFileSystemHandle !== 'undefined') {
        items[0].getAsFileSystemHandle().then(function (handle) {
            if (handle.kind === 'file') {
                processNativeFileHandle(handle);
            } else if (handle.kind === 'directory') {
                processNativeDirHandle(handle);
            }
        });
    } else {
        var files = packet.dataTransfer.files;
        document.getElementById('openLocalFiles').style.display = 'none';
        document.getElementById('rescanStorage').style.display = 'block';
        document.getElementById('usage').style.display = 'none';
        params.rescan = false;
        setLocalArchiveFromFileList(files);
        // This clears the display of any previously picked archive in the file selector
        document.getElementById('archiveFilesLegacy').value = '';
    }
}

function pickFileUWP() { //Support UWP FilePicker [kiwix-js-windows #3]
    // Create the picker object and set options
    var filePicker = new Windows.Storage.Pickers.FileOpenPicker;
    filePicker.suggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.downloads;
    // Filter folder contents
    filePicker.fileTypeFilter.replaceAll([".zim"]);
    filePicker.pickSingleFileAsync().then(processPickedFileUWP);
}

function pickFileNativeFS() {
    return window.showOpenFilePicker({multiple: false}).then(function(fileHandle) {
        return processNativeFileHandle(fileHandle[0]);
    });
}

// Electron file pickers
if (window.dialog) {
    dialog.on('file-dialog', function (fullPath) {
        console.log('Path: ' + fullPath);
        fullPath = fullPath.replace(/\\/g, '/');
        var pathParts = fullPath.match(/^(.+[/\\])([^/\\]+)$/i);
        params.rescan = false;
        createFakeFileObjectNode(pathParts[2], fullPath, processFakeFile);
    });
    dialog.on('dir-dialog', function (fullPath) {
        console.log('Path: ' + fullPath);
        fullPath = fullPath.replace(/\\/g, '/');
        scanNodeFolderforArchives(fullPath);
    });
}

function processFakeFile(fakeFileList) {
    var fakeFile = fakeFileList[0];
    if (fakeFile.size) {
        params.pickedFile = fakeFile;
        params.storedFile = fakeFile.name;
        params.storedFilePath = fakeFile.path;
        settingsStore.removeItem('pickedFolder');
        params.pickedFolder = '';
        if (window.nw && window.showOpenFilePicker) {
            populateDropDownListOfArchives([fakeFile.name]);
        } else {
            populateDropDownListOfArchives([fakeFile.name]);
            if (!params.rescan) setLocalArchiveFromFileList([fakeFile]);
        }
    } else {
        // This shouldn't happen!
        params.showFileSelectors = true;
        document.getElementById('hideFileSelectors').style.display = 'inline';
        document.getElementById('btnConfigure').click();
        setTimeout(function () {
            uiUtil.systemAlert('The packaged file cannot be loaded!\nPlease check that it is in the "' + params.archivePath + '" folder\nor pick a new ZIM file.');
        }, 10);
    }
}

function pickFolderNativeFS() {
    window.showDirectoryPicker().then(function (dirHandle) {
        // Do not attempt to jump to file (we have to let user choose)
        params.rescan = true;
        return processNativeDirHandle(dirHandle);
    }).catch(function(err) {
        console.error('Error reading directory', err);
    });
}

function processNativeFileHandle(fileHandle) {
    var handle = fileHandle;
    // Serialize fileHandle to indexedDB
    cache.idxDB('pickedFSHandle', fileHandle, function (val) {
        console.log('IndexedDB responded with ' + val);
    });
    settingsStore.setItem('lastSelectedArchive', fileHandle.name, Infinity);
    params.storedFile = fileHandle.name;
    params.pickedFolder = null;
    return fileHandle.getFile().then(function(file) {
        file.handle = handle;
        params.pickedFile = file;
        params.rescan = false;
        populateDropDownListOfArchives([file.name]);
    });
}

function processPickedFileUWP(file) {
    if (file) {
        if (params.falFolderToken && /\.zim\w\w$/i.test(file.name)) {
            // This is a split file in a picked folder, so we need to process differently
            params.pickedFile = '';
            setLocalArchiveFromArchiveList([file]);
            return;
        }
        // Cache file so the contents can be accessed at a later time
        Windows.Storage.AccessCache.StorageApplicationPermissions.futureAccessList.addOrReplace(params.falFileToken, file);
        params.pickedFile = file;
        if (params.pickedFolder) Windows.Storage.AccessCache.StorageApplicationPermissions.futureAccessList.remove(params.falFolderToken);
        params.pickedFolder = "";
        settingsStore.setItem("lastSelectedArchive", file.name, Infinity);
        params.storedFile = file.name;
        // Since we've explicitly picked a file, we should jump to it
        params.rescan = false;
        populateDropDownListOfArchives([file.name]);
    } else {
        // The picker was dismissed with no selected file
        console.log("User closed folder picker without picking a file");
    }
}

function pickFolderUWP() { //Support UWP FilePicker [kiwix-js-windows #3]
    var folderPicker = new Windows.Storage.Pickers.FolderPicker;
    folderPicker.suggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.downloads;
    folderPicker.fileTypeFilter.replaceAll([".zim", ".dat", ".idx", ".txt", ".zimaa"]);

    folderPicker.pickSingleFolderAsync().done(function (folder) {
        if (folder) {
            scanUWPFolderforArchives(folder);
        }
    });
}

function processNativeDirHandle(dirHandle, callback) {
    // Serialize dirHandle to indexedDB
    cache.idxDB('pickedFSHandle', dirHandle, function (val) {
        console.debug('IndexedDB responded with ' + val);
    });
    params.pickedFolder = dirHandle;
    params.pickedFile = '';
    // We have to iterate async function with Promise because IE11 compiler throws error if we use async
    var archiveList = [];
    var entryList = dirHandle.entries();
    (function iterateAsyncDirEntryArray() {
        return entryList.next().then(function (result) {
            if (!result.done) {
                var entry = result.value[1];
                if (/\.zim(\w\w)?$/.test(entry.name)) {
                    if (callback) archiveList.push(entry);
                    // Hide all parts of split file except first in UI
                    else if (/\.zim(aa)?$/.test(entry.name)) archiveList.push(entry.name);
                    if (!params.pickedFolder.path) entry.getFile().then(function(file) {
                        params.pickedFolder.path = file.path;
                    })
                }
                iterateAsyncDirEntryArray();
            } else {
                var noZIMFound = document.getElementById('noZIMFound');
                if (archiveList.length) {
                    if (callback) {
                        callback(archiveList);
                    } else {
                        noZIMFound.style.display = 'none';
                        populateDropDownListOfArchives(archiveList);
                    }
                } else {
                    if (callback) {
                        callback(null);
                    } else {
                        noZIMFound.style.display = 'block';
                        populateDropDownListOfArchives(archiveList);
                    }
                }
            }
        }).catch(function (err) {
            uiUtil.systemAlert('<p>We could not find your archive! Is the location or file still available? Try picking the file or folder again.</p>' + 
                '<p>[System error message: ' + err.message + ']</p>', 'Error!');
        });
    })();
    var archiveDisplay = document.getElementById('chooseArchiveFromLocalStorage');
    archiveDisplay.style.display = 'block';
}

function scanNodeFolderforArchives(folder, callback) {
    if (folder) {
        fs.readdir(folder, function (err, files) {
            if (err) console.error('There was an error reading files in the folder: ' + err.message, err);
            else {
                params.pickedFolder = folder;
                settingsStore.setItem('pickedFolder', params.pickedFolder, Infinity);
                params.pickedFile = '';
                processFilesArray(files, callback);
            }
        });
    } else {
        // The picker was dismissed with no selected file
        console.log("User closed folder picker without picking a file");
    }
}

function scanUWPFolderforArchives(folder) {
    if (folder) {
        // Application now has read/write access to all contents in the picked folder (including sub-folder contents)
        // Cache folder so the contents can be accessed at a later time
        Windows.Storage.AccessCache.StorageApplicationPermissions.futureAccessList.addOrReplace(params.falFolderToken, folder);
        params.pickedFolder = folder;
        // Query the folder.
        var query = folder.createFileQuery();
        query.getFilesAsync().done(processFilesArray);
    } else {
        // The picker was dismissed with no selected file
        console.log("User closed folder picker without picking a file");
    }
}

function processFilesArray(files, callback) {
    // Display file list
    var archiveDisplay = document.getElementById('chooseArchiveFromLocalStorage');
    if (files) {
        var filteredFiles = [];
        var archiveList = [];
        files.forEach(function (file) {
            if (/\.zim(aa)?$/i.test(file.fileType) || /\.zim(aa)?$/i.test(file)) {
                archiveList.push(file.name || file);
            }
            if (/\.zim(\w\w)?$/i.test(file.fileType) || /\.zim(\w\w)?$/i.test(file)) {
                filteredFiles.push(file);
            }
        });
        if (archiveList.length) {
            document.getElementById('noZIMFound').style.display = "none";
            populateDropDownListOfArchives(archiveList);
            if (callback) callback(files, archiveList);
            return;
        }
    }
    archiveDisplay.style.display = 'block';
    document.getElementById('noZIMFound').style.display = 'block';
    document.getElementById('archiveList').options.length = 0;
    document.getElementById('archiveList').size = 0;
    document.getElementById('archiveNumber').innerHTML = '<b>0</b> Archives found in local storage (tap "Select storage" to select an archive location)';
    if (/UWP/.test(params.appType)) Windows.Storage.AccessCache.StorageApplicationPermissions.futureAccessList.remove(params.falFolderToken);
}

function setLocalArchiveFromFileList(files) {
    if (!files.length) {
        if (document.getElementById('configuration').style.display == 'none')
                document.getElementById('btnConfigure').click();
        displayFileSelect();
        return;
    }
    // Check for usable file types
    var firstFileIndex = null;
    for (var i = files.length; i--;) {
        // DEV: you can support other file types by adding (e.g.) '|dat|idx' after 'zim\w{0,2}'
        if (!/\.(?:zim\w{0,2})$/i.test(files[i].name)) {
            uiUtil.systemAlert("One or more files does not appear to be a ZIM file!");
            return;
        }
        // Note the index of the .zimaa file
        firstFileIndex = /\.zimaa$/i.test(files[i].name) ? i : firstFileIndex;
        // Allow reading with electron if we have the path info
        if (typeof window.fs !== 'undefined' && files[i].path) {
            files[i].readMode = 'electron';
            console.log("File path is: " + files[i].path);
        }
    }
    // Check that user hasn't picked just part of split ZIM
    if (files.length == 1 && /\.zim\w\w/i.test(files[0].name)) {
        uiUtil.systemAlert('<p>You have picked only part of a split archive!</p><p>Please select its folder in Config, ' + 
            'or drag and drop <b>all</b> of its parts into Config.</p>').then(function () {
                if (document.getElementById('configuration').style.display === 'none') {
                    document.getElementById('btnConfigure').click();
                }
                displayFileSelect();
            }
        );
    }
    // If the file name is already in the archive list, try to select it in the list
    var listOfArchives = document.getElementById('archiveList');
    // Files aren't in order necessarily, so we need to find
    if (listOfArchives && firstFileIndex) listOfArchives.value = files[firstFileIndex].name;
    // Reset the cssDirEntryCache and cssBlobCache. Must be done when archive changes.
    if (cssBlobCache) cssBlobCache = new Map();
    appstate.selectedArchive = zimArchiveLoader.loadArchiveFromFiles(files, function (archive) {
        // Ensure that the new ZIM output is initially sent to the iframe (e.g. if the last article was loaded in a window)
        // (this only affects jQuery mode)
        appstate.target = 'iframe';
        appstate.wikimediaZimLoaded = appstate.selectedArchive && /wikipedia|wikivoyage|mdwiki|wiktionary/i.test(appstate.selectedArchive._file.name);
        if (params.contentInjectionMode === 'serviceworker') {
            if (!appstate.wikimediaZimLoaded) {
                if (params.manipulateImages) document.getElementById('manipulateImagesCheck').click();
                if (settingsStore.getItem('displayHiddenBlockeElements') === 'auto') params.displayHiddenBlockElements = false;
                if (params.allowHTMLExtraction) document.getElementById('allowHTMLExtractionCheck').click();
                // Set defaults that allow for greatest compabitibility with Zimit ZIM types
                if (params.zimType === 'zimit') {
                    var determinedTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssTheme;
                    if (params.cssTheme === 'auto' && determinedTheme !== 'light' && !/UWP/.test(params.appType)) {
                        params.cssTheme = 'darkReader';
                        document.getElementById('cssWikiDarkThemeDarkReaderCheck').checked = true;
                    }
                    if (!params.windowOpener) {
                        params.noWarning = true;
                        document.getElementById('tabOpenerCheck').click();
                        params.noWarning = false;
                    }
                }
            } else {
                params.noWarning = true;
                if (!params.manipulateImages) document.getElementById('manipulateImagesCheck').click();
                if (settingsStore.getItem('displayHiddenBlockeElements') === 'auto') params.displayHiddenBlockElements = 'auto';
                params.noWarning = false;
                params.cssTheme = settingsStore.getItem('cssTheme') || 'light';
                if (params.cssTheme === 'auto') {
                    document.getElementById('cssWikiDarkThemeDarkReaderCheck').checked = false;
                }
            }
        }
        // The archive is set : go back to home page to start searching
        params.storedFile = archive._file._files[0].name;
        settingsStore.setItem("lastSelectedArchive", params.storedFile, Infinity);
        settingsStore.setItem("lastSelectedArchivePath", archive._file._files[0].path ? archive._file._files[0].path : '', Infinity);
        var reloadLink = document.getElementById("reloadPackagedArchive");
        if (reloadLink) {
            if (params.packagedFile != params.storedFile) {
                reloadLink.style.display = "inline";
                reloadLink.removeEventListener("click", loadPackagedArchive);
                reloadLink.addEventListener("click", loadPackagedArchive);
                document.getElementById("usage").style.display = "none";
            } else {
                reloadLink.style.display = "none";
                currentArchive.style.display = "none";
                document.getElementById("usage").style.display = "inline";
            }
        }
        //This ensures the correct icon is set for the newly loaded archive
        cssUIThemeGetOrSet(params.cssUITheme);
        if (params.rescan) {
            document.getElementById('btnConfigure').click();
            setTimeout(function() {
                document.getElementById('btnConfigure').click();
                params.rescan = false;
            }, 100);
        } else {
            if (typeof Windows === 'undefined' && typeof window.showOpenFilePicker !== 'function' && !window.dialog) {
                document.getElementById('instructions').style.display = 'none';
            } else {
                document.getElementById('openLocalFiles').style.display = 'none';
                document.getElementById('rescanStorage').style.display = 'block';
            }
            document.getElementById('usage').style.display = 'none';
            if (params.rememberLastPage && ~params.lastPageVisit.indexOf(params.storedFile.replace(/\.zim(\w\w)?$/, ''))) {
                var lastPage = params.lastPageVisit.replace(/@kiwixKey@.+/, "");
                goToArticle(lastPage);
            } else {
                // The archive has changed, so we must blank the last page in case the Home page of the new archive
                // has the same title as the previous archive (possible if it is, for example, "index") 
                params.lastPageVisit = '';
                params.lastPageHTML = '';
                document.getElementById('btnHome').click();
            }
        }
    }, function (message, label) {
        // callbackError which is called in case of an error
        uiUtil.systemAlert(message, label);
    });
}

function loadPackagedArchive() {
    // Reload any ZIM files in local storage (whcih the user can't otherwise select with the filepicker)
    
    // Reset params.packagedFile to its original value, in case we manipulated it previously
    params.packagedFile = params.originalPackagedFile;
    params.pickedFile = '';
    settingsStore.removeItem('pickedFolder');
    if (params.localStorage) {
        params.pickedFolder = params.localStorage;
        params.storedFile = params.packagedFile || '';
        scanUWPFolderforArchives(params.localStorage);
        if (!params.rescan) setLocalArchiveFromArchiveList(params.storedFile);
    } else if (typeof window.fs !== 'undefined') {
        // We're in an Electron packaged app
        settingsStore.removeItem('lastSelectedArchive');
        settingsStore.removeItem('lastSelectedArchivePath');
        params.lastPageVisit = '';
        if (params.packagedFile && params.storedFile !== params.packagedFile) {
            // If the app is packed inside an asar archive, we need to alter the archivePath to point outside the asar directory
            if (/\/app.asar\//.test(document.location.href) && !/^\.\.[\\/]/.test(params.archivePath)) params.archivePath = '../' + params.archivePath;
            readNodeDirectoryAndCreateNodeFileObjects(params.archivePath, params.packagedFile).then(function (fileset) {
                var fileObjects = fileset[0], fileNames = fileset[1];
                // params.pickedFile = params.packagedFile;
                params.pickedFolder = params.archivePath;
                settingsStore.setItem('pickedFolder', params.pickedFolder, Infinity);
                params.storedFile = params.packagedFile;
                setLocalArchiveFromFileList(fileObjects);
                populateDropDownListOfArchives(fileNames, true);
            });
            // createFakeFileObjectNode(params.packagedFile, params.archivePath + '/' + params.packagedFile, processFakeFile);
        }
    }
}

/**
 * Sets the localArchive from the File selects populated by user
 */
function setLocalArchiveFromFileSelect() {
    setLocalArchiveFromFileList(document.getElementById('archiveFilesLegacy').files);
    params.rescan = false;
}

/**
 * Creates a fake file object from the given filename and filepath. This can only be used if the app is running
 * in the Electron framework.
 * 
 * @param {String} filename The name of the file to be represented
 * @param {String} filepath The path of the file to be represented
 * @param {Function} callback The function to call back with the constructed file
 */
function createFakeFileObjectNode(filename, filepath, callback) {
    var file = {};
    // For Electron, we need to set an absolute filepath in case the file was launched from a shortcut (and if it's not already absolute)
    if (filepath === params.archivePath + '/' + filename && /^file:/i.test(window.location.protocol)) {
        filepath = decodeURIComponent(window.location.href.replace(/www\/[^/?#]+(?:[?#].*)?$/, '') + filepath);
    }
    // DEV if you get pesky Electron error 'The "path" argument must be one of type string, Buffer, or URL', try commenting below
    // if (/^file:/i.test(filepath)) filepath = new URL(filepath);
    // and uncomment comment line below (seems to depend on node and fs versions) - this line conditionally turns the URL into a filepath string for Windows only
    filepath = /^file:\/+\w:[/\\]/i.test(filepath) ? filepath.replace(/^file:\/+/i, '') : filepath.replace(/^file:\/\//i, '');
    // Remove any drive letter (incompatible with Emscripten NODERAWFS)
    // filepath = filepath.replace(/^\w:/, '');
    file.name = filename;
    file.path = filepath;
    file.readMode = 'electron';
    // Get file size
    fs.stat(file.path, function (err, stats) {
        if (err) {
            file.size = null;
            console.error('File cannot be found!', err);
            uiUtil.systemAlert('The archive you are attempting to load (' + file.path + ') cannot be found. Perhaps it has moved?');
            document.getElementById('btnConfigure').click();
        } else {
            file.size = stats.size;
            console.log("Stored file size is: " + file.size);
        }
        callback([file]);
    });
}

/**
 * Reads a directory using the Node File System API and creates a file object or objects for the requested file or split fileset
 * @param {String} folder The directory path to read  
 * @param {String|Array} file The file or split file array to match in the folder (only file[0] will be tested if it is an array)
 * @returns {Promise<Array>} A Promise for the Array of files matching the requested file
 */
function readNodeDirectoryAndCreateNodeFileObjects(folder, file) {
    return new Promise(function (resolve, reject) {
        var selectedFileSet = [], selectedFileNamesSet = [];
        var count = 0;
        var fileHandle = typeof file === 'string' ? file : file[0];
        if (folder === params.archivePath && /^file:/i.test(window.location.protocol)) {
            folder = decodeURIComponent(window.location.href.replace(/www\/[^/?#]+(?:[?#].*)?$/, '') + folder);
        }
        // Check for a Windows-style path and process accordingly to create absolute path appropriate to fs
        folder = /^file:\/+\w:[/\\]/i.test(folder) ? folder.replace(/^file:\/+/i, '') : folder.replace(/^file:\/\//i, '');
        window.fs.readdir(folder, function (err, fileNames) {
            if (err) {
                reject(err);
            } else if (fileNames) {
                // Deal with split archives
                if (/\.zim\w{0,2}$/i.test(fileHandle)) {
                    var genericFileName = fileHandle.replace(/(\.zim)\w\w$/i, '$1');
                    var fileFilter = new RegExp(genericFileName + '\\w\\w$');
                    if (/\.zim$/i.test(fileHandle)) { fileFilter = new RegExp(genericFileName); } 
                    for (var i = 0; i < fileNames.length; i++) {
                        // Filter filenames so we only get zim or zimaa
                        if (/\.zim(aa)?$/i.test(fileNames[i])) {
                            selectedFileNamesSet.push(fileNames[i]);
                        }
                        if (fileFilter.test(fileNames[i])) {
                            count++;
                            //This gets a pseudo File object from a file handle
                            createFakeFileObjectNode(fileNames[i], folder + '/' + fileNames[i], function (file) {
                                selectedFileSet.push(file[0]);
                                if (count === selectedFileSet.length) {
                                    resolve([selectedFileSet, selectedFileNamesSet]);
                                }
                            });
                        }
                    }
                    if (!selectedFileNamesSet.length) {
                        reject('The requested archive is not in the archive folder ' + folder + '!');
                    }
                } else {
                    reject('The requested archive does not appear to be a ZIM file!');
                }
            } else {
                // Folder was empty...
                // createFakeFileObjectNode(fileHandle, folder + '/' + fileHandle, setLocalArchiveFromFileList);
                reject('No files were found in the folder!');
            } 
         });
    });
}

// Set up the event listener for return to article links
var linkListener = function () {
    setTab();
    if (params.themeChanged) {
        params.themeChanged = false;
        if (history.state !== null) {
            var thisURL = decodeURIComponent(history.state.title);
            goToArticle(thisURL);
        }
    }
};
var returnDivs = document.getElementsByClassName("returntoArticle");
for (var i = 0; i < returnDivs.length; i++) {
    returnDivs[i].addEventListener('click', linkListener);
}


/**
 * Reads a remote archive with given URL, and returns the response in a Promise.
 * This function is used by setRemoteArchives below, for UI tests
 * 
 * @param {String} url The URL of the archive to read
 * @returns {Promise<Blob>} A promise for the requested file (blob)
 */
function readRemoteArchive(url) {
    return new Promise(function (resolve, reject) {
        var request = new XMLHttpRequest();
        request.open("GET", url);
        request.responseType = "blob";
        request.onreadystatechange = function () {
            if (request.readyState === XMLHttpRequest.DONE) {
                if (request.status >= 200 && request.status < 300 || request.status === 0) {
                    // Hack to make this look similar to a file
                    request.response.name = url;
                    resolve(request.response);
                } else {
                    reject("HTTP status " + request.status + " when reading " + url);
                }
            }
        };
        request.onabort = request.onerror = reject;
        request.send();
    });
}

/**
 * This is used in the testing interface to inject remote archives
 * @returns {Promise<Array>} A Promise for an array of archives  
 */
window.setRemoteArchives = function () {
    var readRequests = [];
    Array.prototype.slice.call(arguments).forEach(function (arg) {
        readRequests.push(readRemoteArchive(arg));
    });
    return Promise.all(readRequests).then(function (arrayOfArchives) {
        setLocalArchiveFromFileList(arrayOfArchives);
    }).catch(function (e) {
        console.error('Unable to load remote archive(s)', e);
    });
};

/**
 * Handle key input in the prefix input zone
 * @param {Event} evt The event data to handle
 */
function onKeyUpPrefix(evt) {
    // Use a timeout, so that very quick typing does not cause a lot of overhead
    // It is also necessary for the words suggestions to work inside Firefox OS
    if (window.timeoutKeyUpPrefix) {
        window.clearTimeout(window.timeoutKeyUpPrefix);
    }
    window.timeoutKeyUpPrefix = window.setTimeout(function () {
        var prefix = document.getElementById('prefix').value;
        // Don't process anything if it's the same prefix as recently entered (this prevents searching
        // if user is simply using arrow key to correct something typed).
        if (!/^\s/.test(prefix) && prefix === appstate.tempPrefix) return;
        if (prefix && prefix.length > 0 && (prefix !== appstate.search.prefix || /^\s/.test(prefix))) {
            appstate.tempPrefix = prefix;
            document.getElementById('searchArticles').click();
        }
    }, 1000);
}

function listenForNavigationKeys() {
    var listener = function (e) {
        var hit = false;
        if (/^(Arrow)?Left$/.test(e.key) && (e.ctrlKey||e.altKey)) {
            // Ctrl/Alt-Left was pressed
            e.preventDefault();
            if (hit) return;
            hit = true;
            articleWindow.history.back();
        } else if (/^(Arrow)?Right$/.test(e.key) && (e.ctrlKey||e.altKey)) {
            // Ctrl/Alt-Right was pressed
            e.preventDefault();
            if (hit) return;
            hit = true;
            articleWindow.history.forward();
        }
    };
    articleWindow.removeEventListener('keydown', listener);
    articleWindow.addEventListener('keydown', listener);
}

function listenForSearchKeys() {
    //Listen to iframe key presses for in-page search
    document.getElementById('articleContent').contentWindow.addEventListener('keyup', function (e) {
        //Alt-F for search in article, also patches Ctrl-F for apps that do not have access to browser search
        if ((e.ctrlKey || e.altKey) && e.which == 70) {
            document.getElementById('findText').click();
        }
    });
    document.getElementById('articleContent').contentWindow.addEventListener('keydown', function (e) {
        //Ctrl-P to patch printing support, so iframe gets printed
        if (e.ctrlKey && e.which == 80) {
            e.stopPropagation();
            e.preventDefault();
            printIntercept();
        }
    }, true);
}


/**
 * Search the index for DirEntries with title that start with the given prefix (implemented
 * with a binary search inside the index file)
 * @param {String} prefix The string that must appear at the start of any title searched for
 */
function searchDirEntriesFromPrefix(prefix) {
    if (appstate.selectedArchive !== null && appstate.selectedArchive.isReady()) {
        // Cancel the old search (zimArchive search object will receive this change)
        appstate.search.status = 'cancelled';
        // Initiate a new search object and point appstate.search to it (the zimAcrhive search object will continue to point to the old object)
        appstate.search = {'prefix': prefix, 'status': 'init', 'type': '', 'size': params.maxSearchResultsSize};
        alertBoxHeader.style.display = 'none';
        if (!prefix || /^\s/.test(prefix)) {
            var sel = prefix ? prefix.replace(/^\s(.*)/, '$1') : '';
            if (sel.length) {
                sel = sel.replace(/^(.)(.*)/, function (p0, p1, p2) {
                    return p1.toUpperCase() + p2;
                });
            }
            showZIMIndex(null, sel);
        } else {
            appstate.selectedArchive.findDirEntriesWithPrefix(appstate.search, populateListOfArticles);
        }
    } else {
        uiUtil.clearSpinner();
        // We have to remove the focus from the search field,
        // so that the keyboard does not stay above the message
        document.getElementById('searchArticles').focus();
        uiUtil.systemAlert("Archive not set: please select an archive!");
        document.getElementById('btnConfigure').click();
    }
}
/**
 * Extracts and displays in htmlArticle the first params.maxSearchResultsSize articles beginning with start
 * @param {String} start Optional index number to begin the list with
 * @param {String} prefix Optional search prefix from which to start an alphabetical search
 */
function showZIMIndex(start, prefix) {
    var searchUrlIndex =  /^[-ABCHIJMUVWX]?\//.test(prefix) ? true : false;
    // If we're searching by title index number (other than 0 or null), we should ignore any prefix
    if (isNaN(start)) {
        prefix = prefix || '';
    } else {
        prefix = start > 0 ? '' : prefix;
    }
    appstate.search = {'prefix': prefix, 'state': '', 'searchUrlIndex': searchUrlIndex, 'size': params.maxSearchResultsSize, 'window': params.maxSearchResultsSize};
    if (appstate.selectedArchive !== null && appstate.selectedArchive.isReady()) {
        appstate.selectedArchive.findDirEntriesWithPrefixCaseSensitive(prefix, appstate.search, function (dirEntryArray, nextStart) {
            var docBody = document.getElementById('mymodalVariableContent');
            var newHtml = "";
            for (var i = 0; i < dirEntryArray.length; i++) {
                var dirEntry = dirEntryArray[i];
                // NB Ensure you use double quotes for HTML attributes below - see comment in populateListOfArticles
                newHtml += '\n<a  class="list-group-item" href="#" dirEntryId="' + encodeURIComponent(dirEntry.toStringId()) +
                    '">' + (appstate.search.searchUrlIndex ? dirEntry.namespace + '/' + dirEntry.url : '' + dirEntry.getTitleOrUrl()) + '</a>';
            }
            start = start ? start : 0;
            var back = start ? '<a href="#" data-start="' + (start - params.maxSearchResultsSize) +
                '" class="continueAnchor">&lt;&lt; Previous ' + params.maxSearchResultsSize + '</a>' : '';
            var next = dirEntryArray.length === params.maxSearchResultsSize ? '<a href="#" data-start="' + nextStart +
                '" class="continueAnchor">Next ' + params.maxSearchResultsSize + ' &gt;&gt;</a>' : '';
            var backNext = back ? next ? back + ' | ' + next : back : next;
            // Only construct the ZIM Index if it is not already displayed
            if (document.getElementById('myModal').style.display !== 'block') {
                backNext = '<div class="backNext" style="float:right;">' + backNext + '</div>\n';
                var alphaSelector = [];
                // Set up the alphabetic selector
                var lower = params.alphaChar.charCodeAt();
                var upper = params.omegaChar.charCodeAt();
                if (appstate.search.searchUrlIndex) {
                    lower = '-'.charCodeAt(); upper = 'X'.charCodeAt();
                }
                if (upper <= lower) {
                    alphaSelector.push('<a href="#" class="alphaSelector" data-sel="A">PLEASE SELECT VALID START AND END ALPHABET CHARACTERS IN CONFIGURATION</a>');
                } else {
                    for (i = lower; i <= upper; i++) {
                        var char = String.fromCharCode(i);
                        if (appstate.search.searchUrlIndex) {
                            // In URL search mode, we only show namespaces in alphabet
                            if (!/^[-ABCHIJMUVWX]/.test(char)) continue;
                            char = char + '/'; 
                        }
                        alphaSelector.push('<a href="#" class="alphaSelector" data-sel="' + char + '">' + char + '</a>');
                    }
                }
                // Add selectors for diacritics, etc. for Roman alphabet
                if (String.fromCharCode(lower) === 'A' && String.fromCharCode(upper) == 'Z') {
                    alphaSelector.push('<a href="#" class="alphaSelector" data-sel="¡">¡¿ÀÑ</a>');
                    alphaSelector.unshift('<a href="#" class="alphaSelector" data-sel="!">!#123</a>');
                    // Add way of selecting a non-Roman alphabet
                    var switchAlphaButton = document.getElementById('extraModalFooterContent');
                    // Don't re-add button and event listeners if they already exist
                    if (!/button/.test(switchAlphaButton.innerHTML)) {
                        switchAlphaButton.innerHTML = '<button class="btn btn-primary" style="float:left;" type="button">Switch to non-Roman alphabet</button>';
                        switchAlphaButton.addEventListener('click', function () {
                            var alphaLabel = document.getElementById('alphaCharTxt').parentNode;
                            var panelBody = util.closest(alphaLabel, '.panel-body');
                            if (panelBody && panelBody.style.display === 'none') {
                                var panelHeading = util.getClosestBack(panelBody, function (el) { return /panel-heading/.test(el.className) });
                                if (panelHeading) panelHeading.click();
                            }
                            alphaLabel.style.borderColor = 'red';
                            alphaLabel.style.borderStyle = 'solid';
                            alphaLabel.addEventListener('mousedown', function () {
                                this.style.borderColor = '';
                                this.style.borderStyle = '';
                            });
                            document.getElementById('mycloseMessage').click();
                            document.getElementById('btnConfigure').click();
                            window.location.href = "#otherSettingsDiv";
                        });
                    }
                }
                // Add diacritics for Greek alphabet
                if (params.alphaChar === 'Α' && params.omegaChar == 'Ω') {
                    alphaSelector.push('<a href="#" class="alphaSelector" data-sel="Ϊ">ΪΫά</a>');
                    alphaSelector.unshift('<a href="#" class="alphaSelector" data-sel="΄">ΆΈΉ</a>');
                }
                var alphaString = '<div style="text-align:center">' + (appstate.search.searchUrlIndex ? 'ZIM Namespaces: ' : '') + '[ ' + alphaSelector.join(' | \n') + ' ]</div>\n';
                docBody.innerHTML = '<div style="font-size:120%;"><br />\n' + alphaString + '<br />' + backNext + '</div>\n' +
                    '<h2>ZIM ' + (appstate.search.searchUrlIndex ? 'URL' : 'Archive') + ' Index</h2>\n' +
                    '<div id="zimDirEntryIndex" class="list-group">' + newHtml + '\n</div>\n' +
                    '<div style="font-size:120%">\n' + backNext + '<br /><br />' + alphaString + '</div>\n';
                alphaSelector = docBody.querySelectorAll('.alphaSelector');
                Array.prototype.slice.call(alphaSelector).forEach(function (selector) {
                    selector.addEventListener('click', function (event) {
                        event.preventDefault();
                        var char = selector.dataset.sel;
                        document.getElementById('prefix').value = ' ' + char;
                        showZIMIndex(null, char);
                    });
                });
                uiUtil.clearSpinner();
                document.getElementById('articleListWithHeader').style.display = 'none';
                var modalTheme = document.getElementById('modalTheme');
                modalTheme.classList.remove('dark');
                var determinedTheme = params.cssUITheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssUITheme;
                if (determinedTheme === 'dark') modalTheme.classList.add('dark');
            } else {
                // If the ZIM Index is already displayed, just update the list of articles
                var zimIndex = document.getElementById('zimDirEntryIndex');
                if (zimIndex) zimIndex.innerHTML = newHtml;
                var backNextBlocks = document.querySelectorAll('.backNext');
                if (backNextBlocks) Array.prototype.slice.call(backNextBlocks).forEach(function (block) {
                    block.innerHTML = backNext;
                });
            }
            // This is content that must be changed each time the list of articles changes
            var continueAnchors = docBody.querySelectorAll('.continueAnchor');
            Array.prototype.slice.call(continueAnchors).forEach(function (anchor) {
                anchor.addEventListener('click', function (event) {
                    event.preventDefault();
                    var start = ~~anchor.dataset.start;
                    showZIMIndex(start, (appstate.search.searchUrlIndex ? '/' : ''));
                });
            });
            var indexEntries = docBody.querySelectorAll('.list-group-item');
            Array.prototype.slice.call(indexEntries).forEach(function (index) {
                index.addEventListener('click', function (event) {
                    event.preventDefault();
                    handleTitleClick(event);
                    document.getElementById('mycloseMessage').click();
                });
            });
            if (document.getElementById('myModal').style.display === 'none') {
                uiUtil.systemAlert(' ', '', null, null, null, null, 'myModal');
            }
        }, start);
    }
}


/**
 * Display the list of articles with the given array of DirEntry
 * @param {Array} dirEntryArray The array of dirEntries returned from the binary search
 * @param {Object} reportingSearch The the reporting search object
 */
function populateListOfArticles(dirEntryArray, reportingSearch) {
    // Do not allow cancelled searches to report
    if (reportingSearch.status === 'cancelled') return;
    var stillSearching = appstate.search.status === 'interim';
    var articleListHeaderMessageDiv = document.getElementById('articleListHeaderMessage');
    var nbDirEntry = dirEntryArray ? dirEntryArray.length : 0;

    var message;
    if (stillSearching) {
        message = 'Searching [' + appstate.search.type + ']... found: ' + nbDirEntry + '...' +
        (reportingSearch.scanCount ? ' [scanning ' + reportingSearch.scanCount + ' titles] <a href="#">stop</a>' : '');
    } else if (nbDirEntry >= params.maxSearchResultsSize) {
        message = 'First ' + params.maxSearchResultsSize + (reportingSearch.searchUrlIndex ? ' assets' : ' articles') + ' found: refine your search.';
    } else if (reportingSearch.status === 'error') {
        message = 'Incorrect search syntax! See <a href="#searchSyntaxError" id="searchSyntaxLink">Search syntax</a> in About!'; 
    } else {
        message = 'Finished. ' + (nbDirEntry ? nbDirEntry : 'No') + ' articles found' +
        (appstate.search.type === 'basic' ? ': try fewer words for full search.' : '.');
    }
    if (!stillSearching && reportingSearch.scanCount) message += ' [scanned ' + reportingSearch.scanCount + ' titles]';

    articleListHeaderMessageDiv.innerHTML = message;
    if (stillSearching && reportingSearch.countReport) return;

    var articleListDiv = document.getElementById('articleList');
    var articleListDivHtml = '';
    var listLength = dirEntryArray.length < params.maxSearchResultsSize ? dirEntryArray.length : params.maxSearchResultsSize;
    for (var i = 0; i < listLength; i++) {
        var dirEntry = dirEntryArray[i];
        // NB We use encodeURIComponent rather than encodeURI here because we know that any question marks in the title are not querystrings,
        // and should be encoded [kiwix-js #806]. DEV: be very careful if you edit the dirEntryId attribute below, because the contents must be
        // inside double quotes (in the final HTML string), given that dirEntryStringId may contain bare apostrophes
        // Info: encodeURIComponent encodes all characters except  A-Z a-z 0-9 - _ . ! ~ * ' ( ) 
        var dirEntryStringId = encodeURIComponent(dirEntry.toStringId());
        articleListDivHtml += '<a href="#" dirEntryId="' + dirEntryStringId +
            '" class="list-group-item">' + (reportingSearch.searchUrlIndex ? dirEntry.namespace + '/' + dirEntry.url : '' + dirEntry.getTitleOrUrl()) + '</a>';
    }
    articleListDiv.innerHTML = articleListDivHtml;
    // We have to use mousedown below instead of click as otherwise the prefix blur event fires first 
    // and prevents this event from firing; note that touch also triggers mousedown
    $('#articleList a').on('mousedown', function (e) {
        // Cancel search immediately
        appstate.search.status = 'cancelled';
        handleTitleClick(e);
        document.getElementById('scrollbox').style.height = 0;
        document.getElementById('articleListWithHeader').style.display = 'none';
        return false;
    });
    if (!stillSearching) uiUtil.clearSpinner();
    document.getElementById('articleListWithHeader').style.display = '';
    if (reportingSearch.status === 'error') {
        document.getElementById('searchSyntaxLink').addEventListener('click', function () {
            setTab('about');
            document.getElementById('btnAbout').click();
        });
    }
}
/**
 * Handles the click on the title of an article in search results
 * @param {Event} event The click event to handle
 * @returns {Boolean} Always returns false for JQuery event handling
 */
function handleTitleClick(event) {
    var dirEntryId = decodeURIComponent(event.target.getAttribute('dirEntryId'));
    findDirEntryFromDirEntryIdAndLaunchArticleRead(dirEntryId);
    return false;
}

/**
 * Creates an instance of DirEntry from given dirEntryId (including resolving redirects),
 * and call the function to read the corresponding article
 * @param {String} dirEntryId The stringified Directory Entry to parse and launch
 */
function findDirEntryFromDirEntryIdAndLaunchArticleRead(dirEntryId) {
    if (appstate.selectedArchive.isReady()) {
        var dirEntry = appstate.selectedArchive.parseDirEntryId(dirEntryId);
        // Remove focus from search field to hide keyboard and to allow navigation keys to be used
        document.getElementById('articleContent').contentWindow.focus();
        // Ensure selected search item is displayed in the iframe, not a new window or tab
        appstate.target = 'iframe';
        uiUtil.pollSpinner();
        if (dirEntry.isRedirect()) {
            appstate.selectedArchive.resolveRedirect(dirEntry, readArticle);
        } else {
            params.isLandingPage = false;
            readArticle(dirEntry);
        }
    } else {
        uiUtil.systemAlert('Data files not set');
    }
}

/**
 * Check whether the given URL from given dirEntry equals the expectedArticleURLToBeDisplayed
 * @param {DirEntry} dirEntry The directory entry of the article to read
 * @returns {Boolean} Returns false if the current article does not match the expected article
 */
function isDirEntryExpectedToBeDisplayed(dirEntry) {
    var curArticleURL = dirEntry.namespace + "/" + dirEntry.url;
    if (appstate.expectedArticleURLToBeDisplayed !== curArticleURL) {
        console.debug("url of current article :" + curArticleURL + ", does not match the expected url :" + 
            appstate.expectedArticleURLToBeDisplayed);
        return false;
    }
    return true;
}

/**
 * Read the article corresponding to the given dirEntry
 * @param {DirEntry} dirEntry The directory entry of the article to read
 */
function readArticle(dirEntry) {
    // Reset search prefix to allow users to search the same string again if they want to
    appstate.search.prefix = '';
    // Only update for expectedArticleURLToBeDisplayed.
    appstate.expectedArticleURLToBeDisplayed = dirEntry.namespace + '/' + dirEntry.url;
    params.pagesLoaded++;
    if (dirEntry.isRedirect()) {
        appstate.selectedArchive.resolveRedirect(dirEntry, readArticle);
    } else {
        var mimeType = dirEntry.getMimetype();
        //TESTING//
        console.log('Initiating ' + mimeType  + ' load of ' + dirEntry.namespace + '/' + dirEntry.url + "...");
        alertBoxHeader.style.display = 'none';
        // Set startup parameter to guard against boot loop
        if (settingsStore.getItem('lastPageLoad') !== 'rebooting') settingsStore.setItem('lastPageLoad', 'failed', Infinity);
        // Void the localSearch variable to prevent invalid DOM references remainining [kiwix-js-windows #56]
        localSearch = {};
        // Calculate the current article's ZIM baseUrl to use when processing relative links
        params.baseURL = encodeURI(dirEntry.namespace + '/' + dirEntry.url.replace(/[^/]+$/, ''));
        // URI-encode anything that is not a '/'
        // .replace(/[^/]+/g, function(m) {
        //     return encodeURIComponent(m);
        // });
        if (!/\bx?html\b/i.test(mimeType)) {
            // If the selected article isn't HTML, e.g. it might be a PDF, we can either download it if we recognize the type, or ask the SW to deal with it
            if ((params.zimType === 'zimit' || appstate.search.searchUrlIndex) && 
                /\/(plain|.*javascript|css|csv|.*officedocument|.*opendocument|epub|pdf|zip|png|jpeg|webp|svg|gif|tiff|mp4|webm|mpeg|mp3|octet-stream|warc-headers)/i.test(mimeType)) {
                var download = true;
                return appstate.selectedArchive.readBinaryFile(dirEntry, function (fileDirEntry, content) {
                    if (/^text|\/.*javascript|\/warc-headers/i.test(mimeType)) {
                        if (typeof content !== 'string') content = utf8.parse(content);
                        displayArticleContentInContainer(fileDirEntry, content);
                    } else {
                        uiUtil.displayFileDownloadAlert(dirEntry.title || mimeType.replace(/\//, '-'), download, mimeType, content);
                    }
                    uiUtil.clearSpinner();
                });
            } else if (params.contentInjectionMode === 'serviceworker') {
                articleContainer = window.open("../" + appstate.selectedArchive._file.name + "/" + dirEntry.namespace + "/" + encodeURIComponent(dirEntry.url), 
                    params.windowOpener === 'tab' ? '_blank' : encodeURIComponent(dirEntry.title | mimeType),
                    params.windowOpener === 'window' ? 'toolbar=0,location=0,menubar=0,width=800,height=600,resizable=1,scrollbars=1' : null);
                appstate.target = 'window';
                articleContainer.kiwixType = appstate.target;
                articleWindow = articleContainer;
                uiUtil.clearSpinner();
                return;
            }
        } 
        //Load cached start page if it exists and we have loaded the packaged file
        var htmlContent = 0;
        var zimName = appstate.selectedArchive._file.name.replace(/\.[^.]+$/, '').replace(/_\d+-\d+$/, '');
        if (params.isLandingPage && params.cachedStartPages[zimName]) {
            htmlContent = -1;
            // @TODO: Why are we double-encoding here????? Clearly we double-decode somewhere...
            // var encURL = encodeURIComponent(encodeURIComponent(params.cachedStartPages[zimName]).replace(/%2F/g, '/')).replace(/%2F/g, '/');
            var encURL = encodeURI(encodeURI(params.cachedStartPages[zimName]));
            uiUtil.XHR(encURL, 'text', function (responseTxt, status) {
                htmlContent = /<html[^>]*>/.test(responseTxt) ? responseTxt : 0;
                if (htmlContent) {
                    console.log('Article retrieved from storage cache...');
                    // Alter the dirEntry url and title parameters in case we are overriding the start page
                    dirEntry.url = params.cachedStartPages[zimName].replace(/[AC]\//, '');
                    var title = htmlContent.match(/<title[^>]*>((?:[^<]|<(?!\/title))+)/);
                    dirEntry.title = title ? title[1] : dirEntry.title;
                    appstate.selectedArchive.landingPageUrl = params.cachedStartPages[zimName];
                    displayArticleContentInContainer(dirEntry, htmlContent);
                } else {
                    uiUtil.pollSpinner();
                    appstate.selectedArchive.readUtf8File(dirEntry, function (fileDirEntry, data) {
                        if (fileDirEntry.zimitRedirect) goToArticle(fileDirEntry.zimitRedirect);
                        else displayArticleContentInContainer(fileDirEntry, data);
                    });
                }
            });
        }

        //Load lastPageVisit if it is the currently requested page
        if (!htmlContent) {
            var lastPage = '';
            // NB code below must be able to run async, hence it is a function
            var goToRetrievedContent = function(html) {
                if (/<html[^>]*>/i.test(html)) {
                    console.log("Fast article retrieval from localStorage: " + lastPage);
                    if (/<html[^>]*islandingpage/i.test(html)) {
                        params.isLandingPage = true;
                        appstate.selectedArchive.landingPageUrl = dirEntry.namespace + '/' + dirEntry.url;
                    }
                    setTimeout(function () {
                        displayArticleContentInContainer(dirEntry, html);
                    }, 0);
                } else {
                    //if (params.contentInjectionMode === 'jquery') {
                    // In jQuery mode, we read the article content in the backend and manually insert it in the iframe
                    appstate.selectedArchive.readUtf8File(dirEntry, function (fileDirEntry, data) {
                        if (fileDirEntry.zimitRedirect) goToArticle(fileDirEntry.zimitRedirect);
                        else displayArticleContentInContainer(fileDirEntry, data);
                    });
                    // This is needed so that the html is cached in displayArticleInForm
                    params.lastPageVisit = '';
                    params.lastPageHTML = '';
                    //}
                }
            };
            if (params.rememberLastPage && params.lastPageVisit) lastPage = params.lastPageVisit.replace(/@kiwixKey@.+/, "");
            if (params.rememberLastPage && dirEntry.namespace + '/' + dirEntry.url === lastPage) {
                if (!params.lastPageHTML) {
                    // DEV: Timout is needed here to allow time for cache capability to be tested before calling it
                    // otherwise the app will return only a memory capibility for apps that use indexedDB
                    setTimeout(function () {
                        cache.getArticle(params.lastPageVisit.replace(/.*@kiwixKey@/, ''), lastPage, function (html) {
                            params.lastPageHTML = html;
                            htmlContent = params.lastPageHTML || htmlContent;
                            goToRetrievedContent(htmlContent);
                        });
                    }, 250);
                } else {
                    htmlContent = params.lastPageHTML;
                    goToRetrievedContent(htmlContent);
                }
                
            } else {
                goToRetrievedContent(htmlContent);
            }
        }
    }
}

// Add event listener to iframe window to check for links to external resources
var filterClickEvent = function (event) {
    console.debug('filetClickEvent fired');
    if (params.contentInjectionMode === 'jquery') return;
    // Trap clicks in the iframe to restore Fullscreen mode
    if (params.lockDisplayOrientation) refreshFullScreen();
    // Find the closest enclosing A tag (if any)
    var clickedAnchor = uiUtil.closestAnchorEnclosingElement(event.target);
    if (clickedAnchor) {
        var href = clickedAnchor.getAttribute('href');
        // We assume that, if an absolute http(s) link is hardcoded inside an HTML string, it means it's a link to an external website.
        // We also do it for ftp even if it's not supported any more by recent browsers...
        if (/^(?:http|ftp)/i.test(href)) {
            console.debug('filterClickEvent opening external link in new tab');
            clickedAnchor.newcontainer = true;
            uiUtil.warnAndOpenExternalLinkInNewTab(event, clickedAnchor);
        } else if (/\.pdf([?#]|$)/i.test(href) && params.zimType !== 'zimit' && !/UWP/.test(params.appType)) { // Not currently supported in UWP app
            // Due to the iframe sandbox, we have to prevent the PDF viewer from opening in the iframe and instead open it in a new tab
            event.preventDefault();
            event.stopPropagation();
            console.debug('filterClickEvent opening new window for PDF');
            clickedAnchor.newcontainer = true;
            window.open(clickedAnchor.href,  params.windowOpener === 'tab' ? '_blank' : clickedAnchor.title,
                params.windowOpener === 'window' ? 'toolbar=0,location=0,menubar=0,width=800,height=600,resizable=1,scrollbars=1' : null);
            // Make sure that the last saved page is not a PDF, or else we'll have a CSP exception on restarting the app
            // @TODO - may not be necessary because params.lastPageVisit is only set when HTML is loaded
        }
    }
};

var loaded = false;
var articleLoadedSW = function (dirEntry) {
    if (loaded) return;
    loaded = true;
    params.lastPageVisit = dirEntry.namespace + '/' + dirEntry.url + '@kiwixKey@' + appstate.selectedArchive._file.name;
    articleDocument = articleWindow.document.documentElement;
    var doc = articleWindow.document;
    var docBody = doc.body;
    // Trap clicks in the iframe to enable us to work around the sandbox when opening external links and PDFs
    articleWindow.removeEventListener('click', filterClickEvent, true);
    articleWindow.addEventListener('click', filterClickEvent, true);
    if (docBody) {
        // Ensure the window target is permanently stored as a property of the articleWindow (since appstate.target can change)
        articleWindow.kiwixType = appstate.target;
        // Deflect drag-and-drop of ZIM file on the iframe to Config
        if (!params.disableDragAndDrop && appstate.target === 'iframe') {
            docBody.addEventListener('dragover', handleIframeDragover);
            docBody.addEventListener('drop', handleIframeDrop);
            setupTableOfContents();
            listenForSearchKeys();
        }
        switchCSSTheme();
        //Set relative font size + Stackexchange-family multiplier
        var zimType = /-\/s\/style\.css/i.test(doc.head.innerHTML) ? "desktop" : "mobile";
        zimType = /-\/static\/main\.css|statc\/css\/sotoki.css/i.test(doc.head.innerHTML) ? "desktop-stx" : zimType; //Support stackexchange
        zimType = /minerva|mobile[^"']*\.css/i.test(doc.head.innerHTML) ? "mobile" : zimType;
        var docElStyle = articleDocument.style;
        var zoomProp = '-ms-zoom' in docElStyle ? 'fontSize' : 'zoom' in docElStyle ? 'zoom' : 'fontSize'; 
        docElStyle = zoomProp === 'fontSize' ? docBody.style : docElStyle; 
        docElStyle[zoomProp] = ~zimType.indexOf("stx") && zoomProp === 'fontSize' ? params.relativeFontSize * 1.5 + "%" : params.relativeFontSize + "%";
        // if (appstate.target === 'iframe') uiUtil.initTouchZoom(articleDocument, docBody);
        checkToolbar();
        //Set page width according to user preference
        removePageMaxWidth();
        if (!params.isLandingPage) openAllSections();
        setupHeadings();
        listenForNavigationKeys();
        // We need to keep tabs on the opened tabs or windows if the user wants right-click functionality, and also parse download links
        // We need to set a timeout so that dynamically generated URLs are parsed as well (e.g. in Gutenberg ZIMs)
        if (params.windowOpener) setTimeout(function () {
            parseAnchorsJQuery(dirEntry);
        }, 1500);
        if ((params.zimType === 'open' || params.manipulateImages) && /manual|progressive/.test(params.imageDisplayMode)) {
            images.prepareImagesServiceWorker(articleWindow);
        } else {
            setTimeout(function () {
                images.loadMathJax(articleWindow);
            }, 1000);
        }
        if (params.allowHTMLExtraction && appstate.target === 'iframe') {
            var determinedTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto') : params.cssTheme;
            uiUtil.insertBreakoutLink(determinedTheme);
        }
        // Trap any clicks on the iframe to detect if mouse back or forward buttons have been pressed (Chromium does this natively)
        if (/UWP/.test(params.appType)) docBody.addEventListener('pointerup', onPointerUp);
        // The content is ready : we can hide the spinner
        setTab();
        setTimeout(function() {
            articleDocument.bgcolor = '';
            if (appstate.target === 'iframe') articleContainer.style.display = 'block';
            docBody.style.display = 'block';
        }, 30);
        // Turn off failsafe for SW mode
        settingsStore.setItem('lastPageLoad', 'OK', Infinity);
        // Because this is loading within docBody, it should only get set for HTML documents
        if (params.rememberLastPage) settingsStore.setItem('lastPageVisit', params.lastPageVisit, Infinity);
        uiUtil.clearSpinner();
        // If we reloaded the page to print the desktop style, we need to return to the printIntercept dialogue
        if (params.printIntercept) printIntercept();
        // Jump to any anchor parameter
        if (anchorParameter) {
            var target = articleWindow.document.getElementById(anchorParameter);
            if (target) setTimeout(function () {
                target.scrollIntoView();
            }, 1000);
            anchorParameter = '';
        } 
        params.isLandingPage = false;
    } else {
        loaded = false;
    }
    
    // Show spinner when the article unloads
    articleContainer.onunload = function () {
        if (articleWindow.kiwixType === 'iframe') {
            uiUtil.pollSpinner();
        }
        // if (filterClickEvent) {
        //     articleWindow.removeEventListener('mousedown', filterClickEvent, true);
        // }
    };

};

var loadingArticle = '';

/**
 * Function that handles a message of the messageChannel.
 * It tries to read the content in the backend, and sends it back to the ServiceWorker
 * 
 * @param {Event} event The event object of the message channel
 */
function handleMessageChannelMessage(event) {
    if (event.data.error) {
        console.error("Error in MessageChannel", event.data.error);
        reject(event.data.error);
    } else {
        // We received a message from the ServiceWorker
        if (event.data.action === "askForContent") {
            loaded = false;
            // Zimit archives store URLs encoded, and also need the URI component (search parameter) if any
            var title = params.zimType === 'zimit' ? encodeURI(event.data.title) + event.data.search : event.data.title;
            // If it's an asset, we have to mark the dirEntry so that we don't load it if it has an html MIME type
            var titleIsAsset = /\.(png|gif|jpe?g|svg|css|js|mpe?g|webp|webm|woff2?|eot|mp[43])(\?|$)/i.test(title);
            if (params.zimType === 'zimit') {
                titleIsAsset = !/\??isKiwixHref/.test(title);
            }
            title = title.replace(/\??isKiwixHref/, '');
            if (appstate.selectedArchive && appstate.selectedArchive.landingPageUrl === title) params.isLandingPage = true;
            var messagePort = event.ports[0];
            if (!anchorParameter && event.data.anchorTarget) anchorParameter = event.data.anchorTarget;
            // Intercept landing page if already transformed (because this might have a fake dirEntry)
            // Note that due to inconsistencies in Zimit archives, we need to test the encoded and the decoded version of the title
            if (params.transformedHTML && params.transDirEntry && (title === params.transDirEntry.namespace + '/' + params.transDirEntry.url
                || decodeURIComponent(title) === params.transDirEntry.namespace + '/' + params.transDirEntry.url)) {
                var message = {
                    'action': 'giveContent',
                    'title': title,
                    'mimetype': 'text/html'
                };
                postTransformedHTML(message, messagePort, params.transDirEntry);
                return;
            }
            var readFile = function (dirEntry) {
                if (dirEntry === null) {
                    console.error("Title " + title + " not found in archive.");
                    if (!titleIsAsset && params.zimType === 'zimit') {
                        // Use special routine to handle not-found titles for Zimit
                        goToArticle(decodeURI(title));
                    } else if (title === loadingArticle) {
                        goToMainArticle();
                    } else {
                        messagePort.postMessage({
                            'action': 'giveContent',
                            'title': title,
                            'content': ''
                        });
                    }
                    return;
                } else if (dirEntry.isRedirect()) {
                    appstate.selectedArchive.resolveRedirect(dirEntry, function (resolvedDirEntry) {
                        var redirectURL = resolvedDirEntry.namespace + "/" + resolvedDirEntry.url;
                        // Ask the ServiceWork to send an HTTP redirect to the browser.
                        // We could send the final content directly, but it is necessary to let the browser know in which directory it ends up.
                        // Else, if the redirect URL is in a different directory than the original URL,
                        // the relative links in the HTML content would fail. See #312
                        messagePort.postMessage({
                            'action': 'sendRedirect',
                            'title': title,
                            'redirectUrl': redirectURL
                        });
                    });
                } else {
                    var mimetype = dirEntry.getMimetype();
                    var imageDisplayMode = params.imageDisplayMode;
                    // These ZIM types have so much dynamic content that we have to allow all images
                    if (params.imageDisplay && (/gutenberg|phet/i.test(appstate.selectedArchive._file.name) ||
                        params.isLandingPage || params.zimType === 'zimit')) {
                        imageDisplayMode = 'all';
                    }
                    // console.debug('Spinner should show now: [' + mimetype + '] ' + title);
                    if (/\b(css|javascript|video|vtt|webm)\b/i.test(mimetype)) {
                        var shortTitle = dirEntry.url.replace(/[^/]+\//g, '').substring(0, 18);
                        uiUtil.pollSpinner('Getting ' + shortTitle + '...');
                    }
                    // If it's an HTML type and not an asset, we load it in a new page instance
                    if (/\bx?html\b/i.test(mimetype) && !dirEntry.isAsset && !/\.(png|gif|jpe?g|svg|css|js|mpe?g|webp|webm|woff2?|eot|mp[43])(\?|$)/i.test(dirEntry.url)) {
                        loadingArticle = title;
                        // Intercept files of type html and apply transformations
                        var message = {
                            'action': 'giveContent',
                            'title': title,
                            'mimetype': mimetype,
                            'imageDisplay': imageDisplayMode
                        };
                        if (!params.transformedHTML) {
                            // It's an unstransformed html file, so we need to do some content transforms and wait for the HTML to be available
                            if (!~params.lastPageVisit.indexOf(dirEntry.url)) params.lastPageVisit = '';
                            // Tell the read routine that the request comes from a messageChannel 
                            appstate.messageChannelWaiting = true;
                            readArticle(dirEntry);
                            setTimeout(postTransformedHTML, 300, message, messagePort, dirEntry);
                        } else {
                            postTransformedHTML(message, messagePort, dirEntry);
                        }
                        return;
                    } else {
                        loadingArticle = '';
                    }
                    var cacheKey = appstate.selectedArchive._file.name + '/' + title;
                    cache.getItemFromCacheOrZIM(appstate.selectedArchive, cacheKey, dirEntry).then(function (content) {
                        console.debug('SW read binary file for: ' + dirEntry.namespace + '/' + dirEntry.url);
                        if (params.zimType === 'zimit' && loadingArticle) {
                            // We need to work around the redirection script in all Zimit HTML files in case we're loading the HTML in a new window
                            // The script doesn't fire in the iframe, but it does in the new window, so we need to edit it
                            content = content.replace(/!(window._WBWombat)/, '$1');
                        }
                        // Let's send the content to the ServiceWorker
                        var buffer = content.buffer ? content.buffer : content;
                        var message = {
                            'action': 'giveContent',
                            'title': title,
                            'mimetype': mimetype,
                            'imageDisplay': imageDisplayMode,
                            'content': buffer
                        };
                        if (dirEntry.nullify) {
                            message.content = '';
                        } else if (!params.windowOpener && /\/pdf\b/.test(mimetype)) {
                            // This is a last gasp attempt to avoid a CSP violation with PDFs. If windowOpener is set, then they should open
                            // in a new window, but if user has turned that off, we need to offer PDFs as a download
                            uiUtil.displayFileDownloadAlert(title, true, mimetype, content);
                            uiUtil.clearSpinner();
                            return;
                        }
                        // if (content.buffer) {
                        //     // In Edge Legacy, we have to transfer the buffer inside an array, whereas in Chromium, this produces an error
                        //     // due to type not being transferrable... (and already detached, which may be to do with storing in IndexedDB in Electron)
                        //     // if ('MSBlobBuilder' in window) buffer = [buffer];
                        //     messagePort.postMessage(message, [buffer]);
                        // }
                        // It appears doing it simply like this works in all browsers...
                        messagePort.postMessage(message);
                    });
                }
            };
            if (params.zimType === 'zimit') title = title.replace(/^([^?]+)(\?[^?]*)?$/, function (m0, m1, m2) {
                // Note that Zimit ZIMs store ZIM URLs encoded, but SOME incorrectly encode using encodeURIComponent, instead of encodeURI!
                return m1.replace(/[&]/g, '%26').replace(/,/g, '%2C') + (m2 || '');
            });
            // Intercept YouTube video requests
            if (params.zimType === 'zimit' && /youtubei.*player/.test(title)) {
                var cns = appstate.selectedArchive.getContentNamespace();
                var newTitle = (cns === 'C' ? 'C/' : '') + 'A/' + 'youtube.com/embed/' + title.replace(/^[^?]+\?key=([^&]+).*/, '$1');
                newTitle = 'videoembed/' + newTitle; // This is purely to match the regex in transformZimit
                transformZimit.transformVideoUrl(newTitle, articleDocument, function (newVideoUrl) {
                    // NB this will intentionally fail, as we don't want to look up content yet
                    return newVideoUrl;
                });
                return;
            }
            appstate.selectedArchive.getDirEntryByPath(title).then(function (dirEntry) {
                if (dirEntry) dirEntry.isAsset = titleIsAsset;
                return readFile(dirEntry);
            }).catch(function (err) {
                console.error('Failed to read ' + title, err);
                messagePort.postMessage({
                    'action': 'giveContent',
                    'title': title,
                    'content': new Uint8Array
                });
            });
        } else {
            console.error("Invalid message received", event.data);
        }
    }
}

function postTransformedHTML(thisMessage, thisMessagePort, thisDirEntry) {
    if (params.transformedHTML && /<html[^>]*>/i.test(params.transformedHTML)) {
        // Because UWP app window can only be controlled from the Service Worker, we have to allow all images
        // to be called from any external windows. NB messageChannelWaiting is only true when user requested article from a UWP window
        if (/UWP/.test(params.appType) && (appstate.target === 'window' || appstate.messageChannelWaiting) &&
            params.imageDisplay) { thisMessage.imageDisplay = 'all'; }
        // We need to do the same for Gutenberg and PHET ZIMs
        if (params.imageDisplay && (/gutenberg|phet/i.test(appstate.selectedArchive._file.name) || params.isLandingPage)) {
            thisMessage.imageDisplay = 'all';
        }
        // Let's send the content to the ServiceWorker
        thisMessage.content = params.transformedHTML;
        params.transformedHTML = '';
        params.transDirEntry = null;
        loaded = false;
        // If loading the iframe, we can hide the frame for UWP apps (for others, the doc should already be hidden)
        // NB Test for messageChannelWaiting filters out requests coming from a UWP window
        if (articleContainer.kiwixType === 'iframe' && !appstate.messageChannelWaiting) {
            if (/UWP/.test(params.appType)) {
                articleContainer.style.display = 'none';
                setTimeout(function () {
                    if (!loaded) articleLoadedSW(thisDirEntry);
                }, 800);
            }
            articleContainer.onload = function() {
                if (!loaded) articleLoadedSW(thisDirEntry);
            };
        } else {
            // New windows do not respect the onload event because they've been pre-populated,
            // so we have to simulate this event (note potential for race condition if timeout is too short)
            // NB The UWP app cannot control the opened window, so it can only be controlled by the Service Worker
            setTimeout(function () {
                uiUtil.clearSpinner();
            }, 2000);
            if (!/UWP/.test(params.appType)) {
                setTimeout(function () {
                    if (!loaded) articleLoadedSW(thisDirEntry);
                }, 400);
            }
        }
        thisMessagePort.postMessage(thisMessage);
        appstate.messageChannelWaiting = false;
        // Failsafe to turn off spinner
        setTimeout(function () {
            uiUtil.clearSpinner();
        }, 5000);
    } else if (appstate.messageChannelWaiting) {
        setTimeout(postTransformedHTML, 500, thisMessage, thisMessagePort, thisDirEntry);
    }
}

// Compile some regular expressions needed to modify links
// Pattern to find the path in a url
var regexpPath = /^(.*\/)[^\/]+$/;
// Pattern to find a ZIM URL (with its namespace) - see https://wiki.openzim.org/wiki/ZIM_file_format#Namespaces
params.regexpZIMUrlWithNamespace = /^[./]*([-ABCHIJMUVWX]\/.+)$/;
// The case-insensitive regex below finds images, scripts, stylesheets (not tracks) with ZIM-type metadata and image namespaces.
// It first searches for <img, <script, <link, etc., then scans forward to find, on a word boundary, either src=["'] or href=["']
// (ignoring any extra whitespace), and it then tests the path of the URL with a non-capturing negative lookahead (?!...) that excludes
// absolute URIs with protocols that conform to RFC 3986 (e.g. 'http:', 'data:'). It then captures the whole of the URL up until either
// the opening delimiter (" or ', which is capture group \3) or a querystring or hash character (? or #). When the regex is used
// below, it will be further processed to calculate the ZIM URL from the relative path. This regex can cope with legitimate single
// quote marks (') in the URL.
params.regexpTagsWithZimUrl = /(<(?:img|script|link)\b[^>]*?\s)(?:src|href)(\s*=\s*(["']))(?![a-z][a-z0-9+.-]+:)(.+?)(?=\3|\?|#)([\s\S]*?>)/ig;
// Similar to above, but tailored for Zimit links
// params.regexpZimitLinks = /(<(?:a|img|script|link|track)\b[^>]*?\s)(?:src|href)(=(["']))(?!#)(.+?)(?=\3|\?|#)([\s\S]*?>)/ig;
// Regex below tests the html of an article for active content [kiwix-js #466]
// It inspects every <script> block in the html and matches in the following cases: 1) the script loads a UI application called app.js,
// init.js, or other common scripts found in unsupported ZIMs; 2) the script block has inline content that does not contain
// "importScript()", "toggleOpenSection" or an "articleId" assignment (these strings are used widely in our fully supported wikimedia ZIMs,
// so they are excluded); 3) the script block is not of type "math" (these are MathJax markup scripts used extensively in Stackexchange
// ZIMs). Note that the regex will match ReactJS <script type="text/html"> markup, which is common in unsupported packaged UIs, e.g. PhET ZIMs.
var regexpActiveContent = /<script\b(?:(?![^>]+src\b)|(?=[^>]+src\b=["'][^"']*?\b(?:app|init|l1[08]9)\.js))(?![^<]+(?:importScript\(\)|toggleOpenSection|articleId\s?=\s?['"]|window.NREUM))(?![^>]+type\s*=\s*["'](?:math\/|[^"']*?math))/i;
// DEV: The regex below matches ZIM links (anchor hrefs) that should have the html5 "donwnload" attribute added to 
// the link. This is currently the case for epub and pdf files in Project Gutenberg ZIMs -- add any further types you need
// to support to this regex. The "zip" has been added here as an example of how to support further filetypes
var regexpDownloadLinks = /^.*?\.epub([?#]|$)|^.*?\.pdf([?#]|$)|^.*?\.odt([?#]|$)|^.*?\.zip([?#]|$)/i;

// This matches the data-kiwixurl of all <link> tags containing rel="stylesheet" or "...icon" in raw HTML unless commented out
var regexpSheetHref = /(<link\s+(?=[^>]*rel\s*=\s*["'](?:stylesheet|[^"']*icon))[^>]*(?:href|data-kiwixurl)\s*=\s*["'])([^"']+)(["'][^>]*>)(?!\s*--\s*>)/ig;

// A string to hold any anchor parameter in clicked ZIM URLs (as we must strip these to find the article in the ZIM)
var anchorParameter;

params.containsMathTexRaw = false;
params.containsMathTex = false;
params.containsMathSVG = false;
var treePath;

// Stores a url to direntry mapping and is refered to/updated anytime there is a css lookup
// When archive changes these caches should be reset. 
// Currently happens only in setLocalArchiveFromFileList and setLocalArchiveFromArchiveList.
//var cssDirEntryCache = new Map(); //This one is never hit!
var cssBlobCache = new Map();

/**
 * Display the the given HTML article in the web page,
 * and convert links to javascript calls
 * NB : in some error cases, the given title can be null, and the htmlArticle contains the error message
 * @param {DirEntry} dirEntry The Directory Entry of the article
 * @param {String} htmlArticle The decoded HTML of the article
 */
function displayArticleContentInContainer(dirEntry, htmlArticle) {
    //if (! isDirEntryExpectedToBeDisplayed(dirEntry)) {
    //    return;
    //}		

    //TESTING
    console.log('** HTML received for article ' + dirEntry.url + ' **');
    
    if (!/\bx?html\b/.test(dirEntry.getMimetype())) {
        // Construct an HTML document to wrap the content
        htmlArticle = '<html><body style="color:yellow;background:darkblue;"><pre>' + htmlArticle + '</pre></body></html>';
        // Ensure the window target is permanently stored as a property of the articleWindow (since appstate.target can change)
        articleWindow.kiwixType = appstate.target;
        // Scroll the old container to the top
        articleWindow.scrollTo(0,0);
        articleDocument = articleWindow.document.documentElement;
        articleDocument.innerHTML = htmlArticle;
        return;
    }
    // If we find a stylesheet beginning with a root-relative link ('/something.css'), then we're in a very old legacy ZIM
    params.isLegacyZIM = false;
    if (params.zimType === 'open') {
        params.isLegacyZIM = /<link\b[^>]+href\s*=\s*["']\/[^."']+\.css["']/i.test(htmlArticle);
    }
    params.isLandingPage = appstate.selectedArchive.landingPageUrl === dirEntry.namespace + '/' + dirEntry.url ?
        true : params.isLandingPage;
    // Due to fast article retrieval algorithm, we need to embed a reference to the landing page in the html
    if (params.isLandingPage && !/<html[^>]*islandingpage/i.test(htmlArticle)) {
        htmlArticle = htmlArticle.replace(/(<html[^>]*)>/i, '$1 data-kiwixid="islandingpage">');
    }

    // Display Bootstrap warning alert if the landing page contains active content
    if (!params.hideActiveContentWarning && params.isLandingPage && (params.contentInjectionMode === 'jquery'
        || params.manipulateImages || params.allowHTMLExtraction || params.zimType === 'zimit')) {
        if (params.isLegacyZIM || regexpActiveContent.test(htmlArticle)) {
            // Exempted scripts: active content warning will not be displayed if any listed script is in the html [kiwix-js #889]
            if (params.isLegacyZIM || !/<script\b[^'"]+['"][^'"]*?mooc\.js/i.test(htmlArticle)) {
                uiUtil.displayActiveContentWarning(params.isLegacyZIM ? 'legacy' : params.zimType);
            }
        }
    }


    // App appears to have successfully launched
    params.appIsLaunching = false;
    
    // Calculate the current article's ZIM baseUrl to use when processing relative links
    // (duplicated because we sometimes bypass readArticle above)
    params.baseURL = encodeURI(dirEntry.namespace + '/' + dirEntry.url.replace(/[^/]+$/, ''))
        // URI-encode anything that is not a '/'
        // .replace(/[^/]+/g, function(m) {
        //     return encodeURIComponent(m);
        // });

    //Since page has been successfully loaded, store it in the browser history
    if (params.contentInjectionMode === 'jquery') pushBrowserHistoryState(dirEntry.namespace + '/' + dirEntry.url);
    // Store for fast retrieval
    params.lastPageVisit = dirEntry.namespace + '/' + dirEntry.url + '@kiwixKey@' + appstate.selectedArchive._file.name;
    if (params.rememberLastPage) settingsStore.setItem('lastPageVisit', params.lastPageVisit, Infinity);
    cache.setArticle(appstate.selectedArchive._file.name, dirEntry.namespace + '/' + dirEntry.url, htmlArticle, function(){});
    params.htmlArticle = htmlArticle;

    // Replaces ZIM-style URLs of img, script, link and media tags with a data-kiwixurl to prevent 404 errors [kiwix-js #272 #376]
    // This replacement also processes the URL relative to the page's ZIM URL so that we can find the ZIM URL of the asset
    // with the correct namespace (this works for old-style -,I,J namespaces and for new-style C namespace)
    if (params.linkToWikimediaImageFile && !params.isLandingPage && /(?:wikipedia|wikivoyage|wiktionary|mdwiki)_/i.test(appstate.selectedArchive._file.name)) {
        var wikiLang = appstate.selectedArchive._file.name.replace(/(?:wikipedia|wikivoyage|wiktionary|mdwiki)_([^_]+).+/i, '$1');
        var wikimediaZimFlavour = appstate.selectedArchive._file.name.replace(/_.+/, '');
    }
    var newBlock;
    var assetZIMUrlEnc;
    var indexRoot = window.location.pathname.replace(/[^\/]+$/, '') + encodeURI(appstate.selectedArchive._file.name) + '/';
    if (params.contentInjectionMode == 'jquery') {
        htmlArticle = htmlArticle.replace(params.regexpTagsWithZimUrl, function(match, blockStart, equals, quote, relAssetUrl, blockClose) {
            // Don't process data URIs (yet)
            if (/data:image/i.test(relAssetUrl)) return match;
            newBlock = match;
            if (params.zimType === 'zimit' && !(relAssetUrl).indexOf(indexRoot)) {
                assetZIMUrlEnc = relAssetUrl.replace(indexRoot, '');
            } else {
                // DEV: Note that deriveZimUrlFromRelativeUrl produces a *decoded* URL (and incidentally would remove any URI component
                // if we had captured it). We therefore re-encode the URI with encodeURI (which does not encode forward slashes) instead
                // of encodeURIComponent.
                assetZIMUrlEnc = encodeURI(uiUtil.deriveZimUrlFromRelativeUrl(relAssetUrl, params.baseURL));
            }
            newBlock = blockStart + 'data-kiwixurl' + equals + assetZIMUrlEnc + blockClose;
            // For Wikipedia archives, hyperlink the image to the File version
            if (wikiLang && /^<img/i.test(blockStart) && !/usemap=/i.test(match)) {
                newBlock = '<a href="https://' + (wikimediaZimFlavour !== 'mdwiki' ? wikiLang + '.' : '') + wikimediaZimFlavour
                    + '.org/wiki/File:' + assetZIMUrlEnc.replace(/^.+\/([^/]+?\.(?:jpe?g|svg|png|gif))[^/]*$/i, '$1')
                    + '" target="_blank">' + newBlock + '</a>'
            }
            return newBlock;
        });
        // We also need to process data:image/webp if the browser needs the WebPMachine
        if (webpMachine) htmlArticle = htmlArticle.replace(/(<img\b[^>]*?\s)src(\s*=\s*["'])(?=data:image\/webp)([^"']+)/ig, '$1data-kiwixurl$2$3');
        // Remove any empty media containers on page (they can cause layout issue in jQuery mode)
        htmlArticle = htmlArticle.replace(/(<(audio|video)\b(?:[^<]|<(?!\/\2))+<\/\2>)/ig, function (p0) {
            return /(?:src|data-kiwixurl)\s*=\s*["']/.test(p0) ? p0 : '';
        });
    } else if (wikiLang || params.manipulateImages) {
        htmlArticle = htmlArticle.replace(params.regexpTagsWithZimUrl, function(match, blockStart, equals, quote, relAssetUrl, blockClose) {
            // Don't process data URIs (yet)
            if (/data:image/i.test(relAssetUrl)) return match;
            newBlock = match;
            // Add the kiwix-display directive so that the SW sends a dummy image instead
            if (params.manipulateImages && params.imageDisplay !== 'all' && /^<img/i.test(blockStart))
                newBlock = newBlock.replace(relAssetUrl, relAssetUrl + '?kiwix-display');
            if (wikiLang) {
                // For Wikipedia archives, hyperlink the image to the File version
                var assetZIMUrl = decodeURIComponent(relAssetUrl);
                if (/^<img/i.test(blockStart) && !/usemap=/i.test(match)) {
                    newBlock = '<a href="https://' + (wikimediaZimFlavour !== 'mdwiki' ? wikiLang + '.' : '') + wikimediaZimFlavour
                        + '.org/wiki/File:' + assetZIMUrl.replace(/^.+\/([^/]+?\.(?:jpe?g|svg|png|gif))[^/]*$/i, '$1')
                        + '" target="_blank">' + newBlock + '</a>'
                }
            }
            return newBlock;
        });
    }

    if (params.zimType === 'open') {
        // Some documents (e.g. Ray Charles Index) can't be scrolled to the very end, as some content remains benath the footer
        // so add some whitespace at the end of the document
        htmlArticle = htmlArticle.replace(/(<\/body>)/i, "\r\n<p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>\r\n$1");
        htmlArticle = htmlArticle.replace(/(dditional\s+terms\s+may\s+apply\s+for\s+the\s+media\s+files[^<]+<\/div>\s*)/i, "$1\r\n<h1></h1><p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>\r\n");

        // Dirty patches that improve performance or layout with Wikimedia ZIMs. DEV: review regularly and remove when no longer needed.
        if (appstate.wikimediaZimLoaded && params.cssCache) {
            // Reduce weight of unused JS archives for mediawiki ZIMs. This patch also removes mediawiki.page.ready.js which breakds the iframe kiwix-js #972
            htmlArticle = htmlArticle.replace(/<script\b[^<]+src=["'][^"']*(mediawiki|jquery|configvars|startup|visibilitytoggles|site|enhancements|scribunto|ext\.math|\.player)[^"']*\.js\b[^<]+<\/script>/gi, '');
            //@TODO - remove this when issue fixed: VERY DIRTY PATCH FOR HTML IN PAGE TITLES on Wikivoyage
            htmlArticle = htmlArticle.replace(/&lt;a href[^"]+"\/wiki\/([^"]+)[^<]+&gt;([^<]+)&lt;\/a&gt;/ig, "<a href=\"$1.html\">$2</a>");
            htmlArticle = htmlArticle.replace(/&lt;(\/?)(i|b|em|strong)&gt;/ig, "<$1$2>");
            //@TODO - remove when fixed on mw-offliner: dirty patch for removing extraneous tags in ids
            htmlArticle = htmlArticle.replace(/(\bid\s*=\s*"[^\s}]+)\s*\}[^"]*/g, "$1");
            //@TODO - remove when fixed in MDwiki ZIM: dirty patch for removing erroneously hard-coded style
            if (/^mdwiki/.test(appstate.selectedArchive._file.name)) htmlArticle = htmlArticle.replace(/(class=['"]thumbinner[^>]+style=['"]width\s*:\s*)\d+px/ig, "$1320px");
            // Remove landing page scripts that don't work in SW mode
            htmlArticle = htmlArticle.replace(/<script\b[^>]+-\/[^>]*((?:images_loaded|masonry)\.min|article_list_home)\.js"[^<]*<\/script>/gi, '');
            // Set max-width for infoboxes (now set in -/s/styles.css)
            // htmlArticle = htmlArticle.replace(/(<table\s+)(class=["'][^"']*infobox\b)/gi, '$1style="max-width:25%;" $2');
            // Remove override sidebar styles recently hard-coded into some Wikipedia ZIMs - reverted due to error with Wikivoyage and now dealt with in styles.css
            // htmlArticle = htmlArticle.replace(/<style\s+data-mw-deduplicate[^<]+<\/style>\s*/gi, '');
            // Edit sidebar style to make it an infobox
            htmlArticle = htmlArticle.replace(/(<table\s+class=["'][^"']*)sidebar\s/gi, '$1infobox ');
            // Remove the script.js that closes top-level sections if user requested this
            if (params.openAllSections) htmlArticle = htmlArticle.replace(/<script\b[^>]+-\/(j\/js_modules\/)?script\.js"[^<]*<\/script>/i, "");
            // Deal with incorrectly sized masonry pages
            htmlArticle = htmlArticle.replace(/(<body\b[^<]+<div\b[^>]+?id=['"]container['"][^>]*)/i, '$1 style="height:auto;"');
            // @TODO Remove when fixed in https://github.com/openzim/mwoffliner/issues/1662
            // Put site.js in the correct position
            htmlArticle = htmlArticle.replace(/(<script\b[^>]+\/site\.js["']><\/script>\s*)((?:[^<]|<(?!\/body))+)/, '$2$1');
        }

        // Gutenberg ZIMs try to initialize before all assets are fully loaded. Affect UWP app.
        htmlArticle = htmlArticle.replace(/(<body\s[^<]*onload=(['"]))([^'"]*init\([^'"]+showBooks\([^'"]+)\2/i, '$1setTimeout(function () {$3}, 300);$2');

        // Remove erroneous content frequently on front page
        htmlArticle = htmlArticle.replace(/<h1\b[^>]+>[^/]*?User:Popo[^<]+<\/h1>\s*/i, "");
        htmlArticle = htmlArticle.replace(/<span\b[^>]+>[^/]*?User:Popo[^<]+<\/span>\s*/i, "");

        // Put misplaced disambiguation header back in its correct position @TODO remove this when fixed in mw-offliner
        var noexcerpt = htmlArticle.match(/<h1\b(?:[^<]|<(?!h2))+?(<dl\b(?:[^<]|<(?!\/dl>)){1,50}?(?:For\sother\s.{5,20}\swith\s|Not\sto\sbe\sconfused\swith|mw-redirect[^<]+travel\stopic|This\sarticle\sis\sa|See\salso:)(?:[^<]|<(?!\/dl>))+<\/dl>\s*)/i);
        if (noexcerpt && noexcerpt[1] && noexcerpt[1].length) {
            htmlArticle = htmlArticle.replace(noexcerpt[1], '');
            htmlArticle = htmlArticle.replace(/(<\/h1>\s*)/i, '$1' + noexcerpt[1]);
        }
        // Put misplaced hatnote headers inside <h1> block back in correct position @TODO remove this when fixed in mw-offliner
        var hatnote;
        var hatnotes = [];
        do {
            hatnote = util.matchOuter(htmlArticle, '<div\\b[^>]+\\b(?:hatnote|homonymie|dablink)\\b', '</div>\\s*', 'i');
            if (hatnote && hatnote.length) {
                // Ensure the next matching hatnote is under h1
                if (/<h1\b(?:[^<]|<(?!h2))+<div\b[^>]+\b(?:hatnote|homonymie|dablink)\b/i.test(htmlArticle)) {
                    htmlArticle = htmlArticle.replace(hatnote[0], '');
                    hatnotes.push(hatnote[0]);
                } else {
                    break;
                }
            }
        } while (hatnote.length);
        // Ensure we replace them in the right order
        for (var i = hatnotes.length; i--;) {
            htmlArticle = htmlArticle.replace(/(<\/h1>\s*)/i, "$1" + hatnotes[i].replace(/(<div\s+)/i, '$1style="padding-top:10px;" '));
        }

        //Remove white background colour (causes flashes in dark mode)
        htmlArticle = htmlArticle.replace(/(<body\b[^>]+style=["'][^"']*)background-color\s*:\s*[^;]+;\s*/i, '$1');
        htmlArticle = htmlArticle.replace(/(<div\b(?=[^>]+class=\s*["'][^"']*mw-body)[^>]+style=["'][^"']*)background-color\s*:\s*[^;]+;\s*/i, '$1');

        //Display IPA pronunciation info erroneously hidden in some ZIMs
        htmlArticle = htmlArticle.replace(/(<span\b[^>]+?class\s*=\s*"[^"]+?mcs-ipa[^>]+?display:\s*)none/i, "$1inline");

        //Remove any background:url statements in style blocks as they cause the system to attempt to load them
        htmlArticle = htmlArticle.replace(/background:url\([^)]+\)[^;}]*/ig, '');

        //Remove the details polyfill: it's poor and doesn't recognize Edgium
        htmlArticle = htmlArticle.replace(/<script\b[^<]+details[^"']*polyfill\.js[^<]+<\/script>\s*/i, '');
        
        //Remove article.js on youtube ZIMs as it erroneously hides description
        htmlArticle = /<video\b/i.test(htmlArticle) ? htmlArticle.replace(/<script\b[^<]+assets\/article\.js[^<]+<\/script>\s*/i, '') : htmlArticle;
        
        //Remove empty div that causes layout issues in desktop style (but don't remove in SW mode, as they are dynamically filled)
        if (params.contentInjectionMode === 'jquery') htmlArticle = htmlArticle.replace(/<div\b[^>]*?>\s*<\/div>\s*/, '');
    }

    if (params.contentInjectionMode == 'jquery') {
        // Neutralize all inline scripts for now (later use above), excluding math blocks or react templates
        htmlArticle = htmlArticle.replace(/<(script\b(?![^>]+type\s*=\s*["'](?:math\/|text\/html|[^"']*?math))(?![^<]*darkreader\.)(?:[^<]|<(?!\/script>))+<\/script)>/ig, function (p0, p1) {
            return '<!-- ' + p1 + ' --!>';
        });
        //Neutralize onload events, as they cause a crash in ZIMs with proprietary UIs
        htmlArticle = htmlArticle.replace(/(<[^>]+?)onload\s*=\s*["'][^"']+["']\s*/ig, '$1');
        //Neutralize onclick events
        htmlArticle = htmlArticle.replace(/(<[^>]+?)onclick\s*=\s*["'][^"']+["']\s*/ig, '$1');
        //Neutralize href="javascript:" links
        htmlArticle = htmlArticle.replace(/href\s*=\s*["']javascript:[^"']+["']/gi, 'href=""');
    // } else if (/journals\.openedition\.org/i.test(params.zimitPrefix)) {
    //     // Neutralize all inline scripts, excluding math blocks or react templates, as they cause a loop on loading article
    //     htmlArticle = htmlArticle.replace(/<(script\b(?![^>]+type\s*=\s*["'](?:math\/|text\/html|[^"']*?math))(?:[^<]|<(?!\/script>))+<\/script)>/ig, function (p0, p1) {
    //         return '<!-- ' + p1 + ' --!>';
    //     });
    }

    /**
     * MathML detection
     */
    
    // Get out of the way if Service Worker mode and there is an existing MathJax installation
    params.useMathJax = params.contentInjectionMode === 'serviceworker' && /<script\b[^>]+MathJax\.js/i.test(htmlArticle) ? 
        false : params.useMathJax;
    // Detect raw MathML on page for certain ZIMs that are expected to have it
    params.containsMathTexRaw = params.useMathJax &&
        /stackexchange|askubuntu|superuser|stackoverflow|mathoverflow|serverfault|stackapps|proofwiki/i.test(appstate.selectedArchive._file.name) ?
        /[^\\](\$\$?)((?:\\\$|(?!\1)[\s\S])+)\1/.test(htmlArticle) : false;
    
    //if (params.containsMathTexRaw) {
    //    //Replace undefined \size controlscript with \normalsize (found on proofwiki)
    //    htmlArticle = htmlArticle.replace(/(\\)size\b/g, '$1normalsize');
    //}
    
    //Replace all TeX SVGs with MathJax scripts
    if (params.useMathJax) {
        // Deal with any newer MathML blocks
        htmlArticle = htmlArticle.replace(/(<math\b[^>]+alttext=(["']))((?:[^"']|[\s\S](?!\2))+?)(\2(?:[^<]|<(?!\/math))+(?:[^<]|<(?!img))+)<img\b[^>]+?class=["'][^"']*?mwe-math-fallback-image[^>]+>/ig,
        function (_p0, p1, _p2, math, p4) {
            // Remove any rogue ampersands in MathJax due to double escaping (by Wikipedia)
            math = math.replace(/&amp;/g, '&');
            // Change any mbox commands to fbox (because KaTeX doesn't support mbox)
            math = math.replace(/mbox{/g, 'fbox{');
            return p1 + math + p4 + '<script type="math/tex">' + math + '</script>';
        });
        // Older math blocks
        htmlArticle = htmlArticle.replace(/<img\s+(?=[^>]+?math-fallback-image)[^>]*?alt\s*=\s*(['"])((?:[^"']|(?!\1)[\s\S])+)[^>]+>/ig,
        function (p0, p1, math) {
            // Remove any rogue ampersands in MathJax due to double escaping (by Wikipedia)
            math = math.replace(/&amp;/g, '&');
            // Change any mbox commands to fbox (because KaTeX doesn't support mbox)
            math = math.replace(/mbox{/g, 'fbox{');
            return '<script type="math/tex">' + math + '</script>';
        });
    }

    params.containsMathTex = params.useMathJax ? /<(script|span)\s+(type|class)\s*=\s*['"]\s*(math\/tex|latex)\s*['"]/i.test(htmlArticle) : false;
    params.containsMathSVG = params.useMathJax ? /<img\s+(?=[^>]+?math-fallback-image)[^>]*?alt\s*=\s*['"][^'"]+[^>]+>/i.test(htmlArticle) : false;

    // Add CSP to prevent external scripts and content - note that any existing CSP can only be hardened, not loosened
        htmlArticle = htmlArticle.replace(/(<head\b[^>]*>)\s*/, '$1\n    <meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: file: blob: bingmaps: about: \'unsafe-inline\' \'unsafe-eval\';"></meta>\n    ');

    // Maker return links
    uiUtil.makeReturnLink(dirEntry.getTitleOrUrl());
    
    if (params.zimType === 'open') {
        //Adapt German Wikivoyage POI data format
        var regexpGeoLocationDE = /<span\s+class="[^"]+?listing-coordinates[\s\S]+?latitude">([^<]+)[\s\S]+?longitude">([^<]+)<[\s\S]+?(<bdi\s[^>]+?listing-name[^>]+>(?:<a\b\s+href[^>]+>)?([^<]+))/ig;
        htmlArticle = htmlArticle.replace(regexpGeoLocationDE, function (match, latitude, longitude, href, id) {
            var html;
            if (/bingmaps/.test(params.mapsURI)) {
                html = '<a href="' + params.mapsURI + '?collection=point.' + latitude + '_' + longitude + '_' + encodeURIComponent(id.replace(/_/g, " ")) + '">\r\n';
            }
            if (/openstreetmap/.test(params.mapsURI)) {
                html = '<a href="' + params.mapsURI + '?mlat=' + latitude + '&mlon=' + longitude + '#map=18/' + latitude + '/' + longitude + '">\r\n';
            }
            html += '<img alt="Map marker" title="Diesen Ort auf einer Karte zeigen" src="app:///www/img/icons/map_marker-30px.png" width="18px" style="position:relative !important;top:-5px !important;margin-top:5px !important" />\r\n</a>' + href;
            return html;
        });

        //Adapt English Wikivoyage POI data format
        var regexpGeoLocationEN = /(href\s?=\s?")geo:([^,]+),([^"]+)("[^>]+?(?:data-zoom[^"]+"([^"]+))?[^>]+>)[^<]+(<\/a>[\s\S]+?<span\b(?=[^>]+listing-name)[\s\S]+?id\s?=\s?")([^"]+)/ig;
        var mapPin30 = '<img alt="Map marker" title="Show this place on a map" src="app:///www/img/icons/map_marker-30px.png" width="18px" style="position:relative !important;top:-5px !important;" />';
        htmlArticle = htmlArticle.replace(regexpGeoLocationEN, function (match, hrefAttr, latitude, longitude, p4, p5, p6, id) {
            var html;
            if (/bingmaps/.test(params.mapsURI)) {
                html = hrefAttr + params.mapsURI + '?collection=point.' + latitude + '_' + longitude + '_' +
                encodeURIComponent(id.replace(/_/g, ' ')).replace(/\.(\w\w)/g, '%$1') +
                (p5 ? '\&lvl=' + p5 : '') + p4.replace(/style=["']\s?background:[^"']+["']/i, '');
            }
            if (/openstreetmap/.test(params.mapsURI)) {
                html = hrefAttr + params.mapsURI + '?mlat=' + latitude + '&mlon=' + longitude + '#map=18/' + latitude + '/' + longitude + 
                    p4.replace(/style=["']\s?background:[^"']+["']/i, '');
            }
            html += mapPin30 + p6 + id;
            return html;
        });

        //Clean up remaining geo: links
        var mapPin18 = '<img alt="Map marker" title="Show this place on a map" src="app:///www/img/icons/map_marker-18px.png" width="12px" />';
        if (/bingmaps:/.test(params.mapsURI)) {
            htmlArticle = htmlArticle.replace(/href=['"]geo:([\d.-]+),([\d.-]+)[^"']*([^>]+>)/ig, 'href="' + params.mapsURI + '?collection=point.$1_$2_' + 
            encodeURIComponent(dirEntry.getTitleOrUrl()) + '$3' + mapPin18 + '&nbsp;');
        }
        if (/openstreetmap/.test(params.mapsURI)) {
            htmlArticle = htmlArticle.replace(/href=['"]geo:([\d.-]+),([\d.-]+)[^"']*([^>]+>)/ig, 'href="' + params.mapsURI + '?mlat=$1&mlon=$2#map=18/$1/$2$3' + mapPin18 + '&nbsp;');
        }

        // Process any app:// links (these are always from the app payload) to match the current protocol
        htmlArticle = htmlArticle.replace(/(['"])app:\/\//g, function (p0, p1) {
            var appRootDir = window.location.href.replace(/\/www\/.*$/i, '');
            return p1 + appRootDir;
        });

        // Remove erroneous caption on maps that displaces the location marker in at least German Wikivoyage
        htmlArticle = htmlArticle.replace(/(<table\b(?=[^>]+class=["']locationMap)(?:[^<]|<(?!\/table>))+?<img\b[^>]+>)<div\s+class=['"]thumbcaption(?:[^<]|<(?!\/div>))+<\/div>((?:[^<]|<(?!\/table>))+?<div\s+style=['"]position:\s*absolute)/ig, "$1$2");

        //Setup endnote backlinks if the ZIM doesn't have any
        htmlArticle = htmlArticle.replace(/<li\b[^>]+id=["']cite[-_]note[-_]([^"']+)[^>]+>(?![^/]+?[↑^])/ig, function (match, id) {
            var fnReturnMatch = '';
            try {
                var fnSearchRegxp = new RegExp('id=["' + "'](cite[-_]ref[-_]" + id.replace(/[-_()+?]/g, "[-_()]+?") + '[^"' + "']*)", 'i');
                fnReturnMatch = htmlArticle.match(fnSearchRegxp);
            } catch (err) {
                console.error('Error constructiong regular expression in app.js', err);
            }
            var fnReturnID = fnReturnMatch ? fnReturnMatch[1] : '';
            return match + '\r\n<a href=\"#' + fnReturnID + '">^&nbsp;</a>';
        });

        // Exempt Nautilus and YouTube based ZIMs from stylesheet preloading
        var nautilus = params.contentInjectionMode === 'serviceworker' ? 
            htmlArticle.match(/<script\b[^>]+['"][^'"]*(?:nautilus|zim_prefix)\.js[^'"]*[^>]*>[^<]*<\/script>\s*/i) : null;
    
    }

    if (params.zimType === 'open' && !nautilus || params.contentInjectionMode === 'jquery') {
        //Preload stylesheets [kiwix-js #149]
        console.log("Loading stylesheets...");
        //Set up blobArray of promises
        var prefix = window.location.pathname.replace(/\/[^/]*$/, '');
        var cssArray = htmlArticle.match(regexpSheetHref);
        var blobArray = [];
        var cssSource = params.cssSource;
        var cssCache = params.cssCache;
        var zimType = "";
        if (cssArray) {
            getBLOB(cssArray);
        } else {
            // Apply dark or light content theme if necessary
            var determinedTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssTheme;
            var contentThemeStyle = (determinedTheme == "dark" && params.cssTheme !== 'darkReader') ? '<link href="' + prefix + '/-/s/style-dark.css" rel="stylesheet" type="text/css">\r\n' :
                params.cssTheme == "invert" ? '<link href="' + prefix + '/-/s/style-dark-invert.css" rel="stylesheet" type="text/css">\r\n' : "";
            htmlArticle = htmlArticle.replace(/\s*(<\/head>)/i, contentThemeStyle + '$1');
            injectHTML();
        }
    } else {
        // Zimit ZIMs in SW mode should not manipulate styles
        injectHTML();
    }

    //Extract CSS URLs from given array of links
    function getBLOB(arr) {
        var testCSS = arr.join();
        zimType = /-\/s\/style\.css/i.test(testCSS) ? "desktop" : zimType;
        zimType = /-\/static\/main\.css|statc\/css\/sotoki.css/i.test(testCSS) ? "desktop-stx" : zimType; //Support stackexchange
        zimType = /gutenberg\.css/i.test(testCSS) ? "desktop-gtb" : zimType; //Support Gutenberg
        zimType = /minerva|mobile/i.test(testCSS) ? "mobile" : zimType;
        cssSource = cssSource == "auto" ? zimType : cssSource; //Default to in-built zimType if user has selected automatic detection of styles
        if (/minerva|inserted.style/i.test(testCSS) && (cssCache || zimType != cssSource)) {
            //Substitute ridiculously long style name TODO: move this code to transformStyles
            for (var i = arr.length; i--;) { //TODO: move to transfromStyles
                arr[i] = /minerva/i.test(arr[i]) ? '<link ' + (params.contentInjectionMode == 'jquery' ? 'data-kiwixurl' : 'href') +
                    '="-/s/style-mobile.css" rel="stylesheet" type="text/css">' : arr[i];
                // Delete stylesheet if will be inserted via minerva anyway (avoid linking it twice)
                if (/inserted.style/i.test(arr[i]) && /minerva/i.test(testCSS)) {
                    arr.splice(i, 1);
                }
            }
        }
        for (var i = 0; i < arr.length; i++) {
            var zimLink = arr[i].match(/(?:href|data-kiwixurl)\s*=\s*['"]([^'"]+)/i);
            zimLink = zimLink ? params.zimType === 'zimit' ? zimLink[1] : decodeURIComponent(uiUtil.removeUrlParameters(zimLink[1])) : '';
            /* zl = zimLink; zim = zimType; cc = cssCache; cs = cssSource; i  */
            var filteredLink = transformStyles.filterCSS(zimLink, zimType, cssCache, cssSource, i);
            if (filteredLink.rtnFunction == "injectCSS") {
                blobArray[i] = filteredLink.zl;
                injectCSS();
            } else {
                resolveCSS(filteredLink.zl, i);
            }
        }
    }

    function resolveCSS(title, index) {
        if (cssBlobCache && cssBlobCache.has(title)) {
            console.log("*** cssBlobCache hit ***");
            blobArray.push([title, cssBlobCache.get(title)]);
            injectCSS();
        } else {
            var cacheKey = appstate.selectedArchive._file.name + '/' + title;
            cache.getItemFromCacheOrZIM(appstate.selectedArchive, cacheKey).then(function (content) {
                //DEV: Uncomment line below and break on next to capture cssContent for local filesystem cache
                //var cssContent = util.uintToString(content);
                var mimetype = /\.ico$/i.test(title) ? 'image' : 'text/css';
                var cssBlob;
                if (content) cssBlob = new Blob([content], {
                    type: mimetype
                });
                var newURL = cssBlob ? [title, URL.createObjectURL(cssBlob)] : [title, ''];
                blobArray.push(newURL);
                if (cssBlobCache)
                    cssBlobCache.set(newURL[0], newURL[1]);
                injectCSS(); //DO NOT move this: it must run within .then function to pass correct values
            }).catch(function (err) {
                console.error(err);
                var newURL = [title, ''];
                blobArray.push(newURL);
                if (cssBlobCache)
                    cssBlobCache.set(newURL[0], newURL[1]);
                injectCSS();
            });
        }
    }

    function injectCSS() {
        // We have to count the blobArray elements because some may have been spliced out
        // See https://stackoverflow.com/questions/28811911/find-array-length-in-javascript
        var blobArrayLength = blobArray.filter(function () {
            return true;
        }).length;
        if (blobArrayLength >= cssArray.length) { //If all promised values have been obtained
            var resultsArray = [];
            var testBlob;
            for (var i in cssArray) { //Put them back in the correct order
                var match = 0;
                for (var j in blobArray) { //Iterate the blobArray to find the matching entry
                    //console.log("blobArray[j]: " + blobArray[j] + "\r\nblobArray[j][0]: " + blobArray[j][0]);
                    testBlob = blobArray[j][0].length == 1 ? blobArray[j] : blobArray[j][0]; //What a kludge! TODO: fix this ugly mixing of arrays and strings 
                    if (~cssArray[i].indexOf(testBlob)) {
                        match = 1;
                        break;
                    }
                }
                testBlob = match && /blob:/i.test(blobArray[j][1]) ? blobArray[j][1] : blobArray[i]; //Whoa!!! Steady on!
                resultsArray[i] = cssArray[i].replace(/(?:data-kiwixurl|href)\s*=\s*["']([^"']+)/i, 'href="' +
                    testBlob + '" data-kiwixhref="$1'); //Store the original URL for later use
                //DEV note: do not attempt to add onload="URL.revokeObjectURL...)": see [kiwix.js #284]
                //DEBUG:
                //console.log("BLOB CSS #" + i + ": " + resultsArray[i] + "\nshould correspond to: " + testBlob);
            }
            cssArray = resultsArray;
            htmlArticle = htmlArticle.replace(regexpSheetHref, ""); //Void existing stylesheets
            var cssArray$ = "\r\n" + cssArray.join("\r\n") + "\r\n";
            if (~cssSource.indexOf("mobile")) { //If user has selected mobile display mode...
                var mobileCSS = transformStyles.toMobileCSS(htmlArticle, zimType, cssCache, cssSource, cssArray$);
                htmlArticle = mobileCSS.html;
                cssArray$ = mobileCSS.css;
            }
            if (~cssSource.indexOf("desktop")) { //If user has selected desktop display mode...
                var desktopCSS = transformStyles.toDesktopCSS(htmlArticle, zimType, cssCache, cssSource, cssArray$);
                htmlArticle = desktopCSS.html;
                cssArray$ = desktopCSS.css;
            }
            //Remove any voided styles
            cssArray$ = cssArray$.replace(/<link\shref="#"[^>]+>\s*/g, '');
            //Add dark mode CSS if required
            var determinedTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssTheme;
            cssArray$ += (determinedTheme === 'dark' && params.cssTheme !== 'darkReader') ? '<link href="' + prefix + '/-/s/style-dark.css" rel="stylesheet" type="text/css">\r\n' :
                params.cssTheme == "invert" ? '<link href="' + prefix + '/-/s/style-dark-invert.css" rel="stylesheet" type="text/css">\r\n' : "";
            //Ensure all headings are open
            //htmlArticle = htmlArticle.replace(/class\s*=\s*["']\s*client-js\s*["']\s*/i, "");
            htmlArticle = htmlArticle.replace(/\s*(<\/head>)/i, cssArray$ + "$1");
            console.log("All CSS resolved");
            injectHTML(); //Pass the revised HTML to the image and JS subroutine...
        }
    }
    //End of preload stylesheets code

    function injectHTML() {
        //Inject htmlArticle into iframe
        // uiUtil.pollSpinner(); //Void progress messages
        // Extract any css classes from the html tag (they will be stripped when injected in iframe with .innerHTML)
        var htmlCSS;
        if (params.contentInjectionMode === 'jquery') htmlCSS = htmlArticle.match(/<html[^>]*class\s*=\s*["']\s*([^"']+)/i);
        htmlCSS = htmlCSS ? htmlCSS[1].replace(/\s+/g, ' ').split(' ') : '';

        // Hide any alert box that was activated in uiUtil.displayFileDownloadAlert function
        var downloadAlert = document.getElementById('downloadAlert');
        if (downloadAlert) downloadAlert.style.display = 'none';

        // Code below will run after we have written the new article to the articleContainer
        var articleLoaded = params.contentInjectionMode === 'serviceworker' ? function() {} : function() {
            // Set a global error handler for articleWindow
            articleWindow.onerror = function (msg, url, line, col, error) {
                console.error('Error caught in ZIM contents [' + url + ':' + line + ']:\n' + msg, error);
                return true;
            };
            uiUtil.clearSpinner();
            if (appstate.target === 'iframe' && !articleContainer.contentDocument && window.location.protocol === 'file:') {
                uiUtil.systemAlert("<p>You seem to be opening kiwix-js with the file:// protocol, which blocks access to the app's iframe. "
                + "We have tried to open your article in a separate window. You may be able to use it with limited functionality.</p>"
                + "<p>The easiest way to run this app fully is to download and run it as a browser extension (from the vendor store). "
                + "Alternatively, you can open it through a web server: either use a local one (http://localhost/...) "
                + "or a remote one. For example, you can try your ZIM out right now with our online version of the app: "
                + "<a href='https://kiwix.github.io/kiwix-js/'>https://kiwix.github.io/kiwix-js/</a>.</p>"
                + "<p>Another option is to force your browser to accept file access (a potential security breach): "
                + "on Chrome, you can start it with the <code>--allow-file-access-from-files</code> command-line argument; on Firefox, "
                + "you can set <code>privacy.file_unique_origin</code> to <code>false</code> in about:config.</p>");
                articleContainer = window.open('', dirEntry.title, 'toolbar=0,location=0,menubar=0,width=800,height=600,resizable=1,scrollbars=1');
                params.windowOpener = 'window';
                appstate.target = 'window';
                articleContainer.kiwixType = appstate.target;
                articleWindow = articleContainer;
            }
            
            // Ensure the window target is permanently stored as a property of the articleWindow (since appstate.target can change)
            articleWindow.kiwixType = appstate.target;
            // Scroll the old container to the top
            articleWindow.scrollTo(0,0);
            articleDocument = articleWindow.document.documentElement;

            // ** Write article html to the new article container **
            articleDocument.innerHTML = htmlArticle;

            var docBody = articleDocument.querySelector('body');

            if (articleWindow.kiwixType === 'iframe') {
                // Add any missing classes stripped from the <html> tag
                if (htmlCSS) htmlCSS.forEach(function (cl) {
                    docBody.classList.add(cl);
                });
                if (!params.disableDragAndDrop) {
                    // Deflect drag-and-drop of ZIM file on the iframe to Config
                    docBody.addEventListener('dragover', handleIframeDragover);
                    docBody.addEventListener('drop', handleIframeDrop);
                }
                listenForSearchKeys();
                // Trap clicks in the iframe to restore Fullscreen mode
                if (params.lockDisplayOrientation) articleWindow.addEventListener('mousedown', refreshFullScreen, true);
                setupTableOfContents();
            }
            //Set relative font size + Stackexchange-family multiplier
            var docElStyle = articleDocument.style;
            var zoomProp = '-ms-zoom' in docElStyle ? 'fontSize' : 'zoom' in docElStyle ? 'zoom' : 'fontSize'; 
            docElStyle = zoomProp === 'fontSize' ? docBody.style : docElStyle;
            docElStyle[zoomProp] = ~zimType.indexOf("stx") && zoomProp === 'fontSize' ? params.relativeFontSize * 1.5 + "%" : params.relativeFontSize + "%";
            //Set page width according to user preference
            removePageMaxWidth();
            setupHeadings();
            listenForNavigationKeys();
            // if (appstate.target === 'iframe') uiUtil.initTouchZoom(articleDocument, docBody);
            // Process endnote references (so they open the reference block if closed)
            var refs = docBody.getElementsByClassName("mw-reflink-text");
            if (refs) {
                for (var l = 0; l < refs.length; l++) {
                    var reference = refs[l].parentElement;
                    if (reference) {
                        reference.addEventListener("click", function (obj) {
                            var refID = obj.target.hash || obj.target.parentNode.hash;
                            if (!refID) return;
                            var refLocation = docBody.querySelector(refID);
                            if (!refLocation) return;
                            // In some ZIMs the id is in the parent node or in the parent of the parent
                            var returnID = obj.target.id || obj.target.parentNode.id || obj.target.parentNode.parentNode.id;
                            // Add backlink to refLocation if missing
                            if (returnID && !~refLocation.innerHTML.indexOf('#' + returnID)) {
                                var returnLink = document.createElement('a');
                                returnLink.href = '#' + returnID;
                                returnLink.innerHTML = '↑';
                                refLocation.insertBefore(returnLink, refLocation.firstChild);
                            }
                            var refNext = util.getClosestBack(refLocation, function (el) {
                                return /^(H2|DETAILS)$/.test(el.tagName);
                            });
                            if (refNext) {
                                if (/DETAILS/.test(refNext.tagName)) {
                                    refNext.open = true;
                                    return;
                                }
                                refNext.classList.add("open-block");
                                //refNext.innerHTML = refNext.innerHTML.replace(/<br\s*\/?>$/i, "");
                                refNext = refNext.nextElementSibling;
                                while (refNext && refNext.classList.contains("collapsible-block")) {
                                    refNext.classList.add("open-block");
                                    refNext = refNext.nextElementSibling;
                                }
                            }
                        });
                    }
                }
            }
            if (!params.isLandingPage) openAllSections();
            
            parseAnchorsJQuery(dirEntry);
            images.prepareImagesJQuery(articleWindow);
            //loadJavascript(); //Disabled for now, since it does nothing - also, would have to load before images, ideally through controlled css loads above
            var determinedTheme = params.cssTheme === 'auto' ? cssUIThemeGetOrSet('auto') : params.cssTheme;
            if (params.allowHTMLExtraction && appstate.target === 'iframe') {
                uiUtil.insertBreakoutLink(determinedTheme);
            }
            // Trap any clicks on the iframe to detect if mouse back or forward buttons have been pressed (Chromium does this natively)
            if (/UWP/.test(params.appType)) docBody.addEventListener('pointerup', onPointerUp);
            // Document has loaded except for images, so we can now change the startup failsafe [see init.js]
            settingsStore.setItem('lastPageLoad', 'OK', Infinity);

            // If we reloaded the page to print the desktop style, we need to return to the printIntercept dialogue
            if (params.printIntercept) printIntercept();

            // Make sure the article area is displayed
            setTab();
            checkToolbar();
            var showArticle = function () {
                articleDocument.bgcolor = "";
                docBody.style.display = 'block';
            };
            if ('MSBlobBuilder' in window) {
                // For legacy MS browsers, including UWP, delay causes blank screen on slow systems
                showArticle();
            } else {
                // For Chromium browsers a small delay greatly improves composition
                setTimeout(showArticle, 80);
            }
            // Jump to any anchor parameter
            if (anchorParameter) {
                var target = articleWindow.document.getElementById(anchorParameter);
                if (target) setTimeout(function () {
                    target.scrollIntoView();
                }, 1000);
                anchorParameter = '';
            } 
            params.isLandingPage = false;
        };

        // For articles loaded in the iframe, we need to set the articleWindow (but if the user is opening a new tab/window,
        // then the articleWindow has already been set in the click event of the ZIM link)
        if (appstate.target === 'iframe') {
            // Tell jQuery we're removing the iframe document: clears jQuery cache and prevents memory leaks [kiwix-js #361]
            $('#articleContent').contents().remove();
            articleContainer = document.getElementById('articleContent');
            articleContainer.kiwixType = 'iframe';
            articleWindow = articleContainer.contentWindow;
        }

        // Hide the document to avoid display flash before stylesheets are loaded; also improves performance during loading of
        // assets in most browsers
        // DEV: We cannot do `articleWindow.document.documentElement.hidden = true;` because documentElement gets overwritten
        // during the document.write() process; and since the latter is synchronous, we get slow display rewrites before it is
        // effective if we do it after document.close().
        // Note that UWP apps cannot communicate to a newly opened window except via postmessage, but Service Worker can still
        // control the Window. Additionally, Edge Legacy cannot build the DOM for a completely hidden document, hence we catch
        // these browser types with 'MSBlobBuilder' (and also IE11).
        if (!(/UWP/.test(params.appType) && (appstate.target === 'window' || appstate.messageChannelWaiting))) {
            htmlArticle = htmlArticle.replace(/(<html\b[^>]*)>/i, '$1 bgcolor="' + 
                (cssUIThemeGetOrSet(params.cssTheme, true) !== 'light' ? 'grey' : 'whitesmoke') + '">');
            // NB Don't hide the document body if we don't have any window management, because native loading of documents in a new tab is slow, and we can't
            // guarantee to unhide the document in time
            if (!('MSBlobBuilder' in window) && params.windowOpener) htmlArticle = htmlArticle.replace(/(<body\b[^>]*)/i, '$1 style="display: none;"');
        }

        // Display any hidden block elements, with a timeout, so as not to interfere with image loading
        if (params.displayHiddenBlockElements && settingsStore.getItem('appVersion') === params.appVersion) {
            setTimeout(function () {
                if (appstate.wikimediaZimLoaded || params.displayHiddenBlockElements === true) {
                    displayHiddenBlockElements(articleWindow, articleDocument);
                }
            }, 1200);
        }
        
        // Calculate the current article's encoded ZIM baseUrl to use when processing relative links (also needed for SW mode when params.windowOpener is set)
        params.baseURL = encodeURI(dirEntry.namespace + '/' + dirEntry.url.replace(/[^/]+$/, ''));
            // URI-encode anything that is not a '/'
        //     .replace(/[^/]+/g, function(m) {
        //         return encodeURIComponent(m);
        // });

        if (params.contentInjectionMode === 'serviceworker') {
            // For UWP apps, we need to add the Zoom level to the HTML if we are opening in external window
            if (/UWP/.test(params.appType) && appstate.target === 'window') {
                htmlArticle = htmlArticle.replace(/(<html\b[^>]+?style=['"])/i, '$1zoom:' + params.relativeFontSize + '%; ');
                htmlArticle = htmlArticle.replace(/(<html\b(?![^>]+?style=['"])\s)/i, '$1style="zoom:' + params.relativeFontSize + '%;" ');
            }
            // Add darkreader script to article
            var determinedWikiTheme = params.cssTheme == 'auto' ? cssUIThemeGetOrSet('auto', true) : params.cssTheme;
            if (determinedWikiTheme !== 'light' && params.cssTheme === 'darkReader') {
                htmlArticle = htmlArticle.replace(/(<\/head>)/i, '<script type="text/javascript" src="' + 
                    document.location.pathname.replace(/index\.html/i, 'js/lib/darkreader.min.js') + '"></script>\r\n' + 
                    '<script>DarkReader.setFetchMethod(window.fetch);\r\nDarkReader.enable();</script>\r\n$1');
            }
            // Prevent the script that detects whether wombat is loaded from running
            if (params.zimType === 'zimit') htmlArticle = htmlArticle.replace(/!(window._WBWombat)/, '$1');
            // Add doctype if missing so that scripts run in standards mode
            // (quirks mode prevents katex from running, and is incompatible with jQuery)
            params.transformedHTML = !/^\s*(?:<!DOCTYPE|<\?xml)\s+/i.test(htmlArticle) ? '<!DOCTYPE html>\n' + htmlArticle : htmlArticle;
            params.transDirEntry = dirEntry;
            // We will need the encoded URL on article load so that we can set the iframe's src correctly,
            // but we must not encode the '/' character or else relative links may fail [kiwix-js #498]
            var encodedUrl = params.zimType === 'zimit' ? dirEntry.url : encodeURI(dirEntry.url);
            // .replace(/[^/]+/g, function (matchedSubstring) {
            //     return encodeURIComponent(matchedSubstring);
            // });
            // If the request was not initiated by an existing controlled window, we instantiate the request here
            if (!appstate.messageChannelWaiting) {
                // We put the ZIM filename as a prefix in the URL, so that browser caches are separate for each ZIM file
                var newLocation = "../" + appstate.selectedArchive._file.name + "/" + dirEntry.namespace + "/" + encodedUrl;
                if (navigator.serviceWorker.controller) {
                    loaded = false;
                    articleWindow.location.href = newLocation;
                }
            }
            return;
        }

        // Write article html to the article container
        // articleWindow.document.open('text/html', 'replace');
        // articleWindow.document.write(htmlArticle);
        // articleWindow.document.close();
        
        if (appstate.target === 'iframe') {
            // Store the frame article's target in the top-level window, so that when we retrieve the window with
            // history manipulation, we'll know where to place the iframe contentWindow
            window.kiwixType = appstate.target;
            articleContainer.onload = articleLoaded;
            articleContainer.src = 'article.html';
        } else { 
            // Attempt to establish an independent history record for windows (jQuery / window-tab mode)
            articleWindow.onpopstate = historyPop;
            // The articleWindow has already been set in the click event of the ZIM link and the dummy article was loaded there
            // (to avoid popup blockers). Firefox loads windows asynchronously, so we need to wait for onclick load to be fully
            // cleared, or else Firefox overwrites the window immediately after we load the html content into it.
            setTimeout(articleLoaded, 400);
        }
        // Failsafe for spinner
        setTimeout(function () {
            uiUtil.clearSpinner();
        }, 6000);
    } // End of injectHtml

} //End of displayArticleInForm()

function parseAnchorsJQuery(dirEntry) {
    var currentProtocol = articleWindow.location.protocol;
    currentProtocol === 'about:' ? currentProtocol = ':' : currentProtocol;
    var currentHost = articleWindow.location.host;
    // Percent-encode dirEntry.url and add regex escape character \ to the RegExp special characters - see https://www.regular-expressions.info/characters.html;
    // NB dirEntry.url can also contain path separator / in some ZIMs (Stackexchange). } and ] do not need to be escaped as they have no meaning on their own. 
    var escapedUrl = encodeURIComponent(dirEntry.url).replace(/([\\$^.|?*+/()[{])/g, '\\$1');
    // Pattern to match a local anchor in an href even if prefixed by escaped url; will also match # on its own
    // Note that we exclude any # with a semicolon between it and the end of the string, to avoid accidentally matching e.g. &#39;
    var regexpLocalAnchorHref = new RegExp('^(?:#|' + escapedUrl + '#)([^#;]*$)');
    Array.prototype.slice.call(articleDocument.querySelectorAll('a, area')).forEach(function (anchor) {
        // Attempts to access any properties of 'this' with malformed URLs causes app crash in Edge/UWP [kiwix-js #430]
        try {
            var testHref = anchor.href;
        } catch (err) {
            console.error('Malformed href caused error:' + err.message);
            return;
        }
        var href = anchor.getAttribute('href');
        if (href === null || href === undefined || /^javascript:/i.test(anchor.protocol)) return;
        var anchorTarget = href.match(regexpLocalAnchorHref);
        if (href.length === 0) {
            // It's a link with an empty href, pointing to the current page: do nothing.
        } else if (anchorTarget) {
            // It's a local anchor link : remove escapedUrl if any (see above)
            anchor.setAttribute('href', '#' + anchorTarget[1]);
        } else if (anchor.protocol && anchor.protocol !== currentProtocol || anchor.host && anchor.host !== currentHost) {
            // It's an external URL : we should open it in a new tab
            anchor.addEventListener('click', function (event) {
                if (anchor.protocol === 'bingmaps:') {
                    anchor.removeAttribute('target');
                    event.preventDefault();
                    window.location = href;
                } else {
                    // Find the closest enclosing A tag
                    var clickedAnchor = uiUtil.closestAnchorEnclosingElement(event.target);
                    uiUtil.warnAndOpenExternalLinkInNewTab(event, clickedAnchor);
                }
            });
        } else {
            // Intercept YouTube videos in Zimit archives
            if (params.zimType === 'zimit' && /youtu(?:be(?:-nocookie)?\.com|\.be)\//i.test(href)) {
                transformZimit.transformVideoUrl(href, articleDocument, function (transHref) {
                    addListenersToLink(anchor, transHref, params.baseURL);
                });
            } else {
                addListenersToLink(anchor, href, params.baseURL);
            }
        }
    });
    // Add event listeners to the main heading so user can open current document in new tab or window by clicking on it
    if (articleWindow.document.body) {
        var h1 = articleWindow.document.body.querySelector('h1');
        if (h1) addListenersToLink(h1, encodeURIComponent(dirEntry.url.replace(/[^/]+\//g, '')), params.baseURL);
    }
}

/**
 * Add event listeners to a hyperlinked element to extract the linked article or file from the ZIM instead
 * of following links
 * @param {Node} a The anchor or other linked element to which event listeners will be attached
 * @param {String} href The href of the linked element
 * @param {String} baseUrl The baseUrl against which relative links will be calculated
 */
function addListenersToLink(a, href, baseUrl) {
    var uriComponent = uiUtil.removeUrlParameters(href);
    // var namespace = baseUrl.replace(/^([-ABCIJMUVWX])\/.+/, '$1');
    var loadingContainer = false;
    var contentType;
    var downloadAttrValue;
    // Some file types need to be downloaded rather than displayed (e.g. *.epub)
    // The HTML download attribute can be Boolean or a string representing the specified filename for saving the file
    // For Boolean values, getAttribute can return any of the following: download="" download="download" download="true"
    // So we need to test hasAttribute first: see https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute
    // However, we cannot rely on the download attribute having been set, so we also need to test for known download file types
    var isDownloadableLink = a.hasAttribute('download') || regexpDownloadLinks.test(href);
    if (isDownloadableLink) {
        // if (!/UWP/.test(params.appType) && params.contentInjectionMode === 'serviceworker') return;
        downloadAttrValue = a.getAttribute('download');
        // Normalize the value to a true Boolean or a filename string or true if there is no download attribute
        downloadAttrValue = /^(download|true|\s*)$/i.test(downloadAttrValue) || downloadAttrValue || true;
        contentType = a.getAttribute('type');
    }
    // DEV: We need to use the '#' location trick here for cross-browser compatibility with opening a new tab/window
    // if (params.windowOpener && a.tagName !== 'IFRAME') a.setAttribute('href', '#' + href);
    // Store the current values, as they may be changed if user switches to another tab before returning to this one
    var kiwixTarget = appstate.target;
    var thisWindow = articleWindow;
    var thisContainer = articleContainer;
    var reset = function () {
        if (appstate.target === 'window') {
            // By delaying unblocking of the touch event, we prevent multiple touch events launching the same window
            a.touched = false;
            a.newcontainer = false;
        }
        loadingContainer = false;
    };
    var onDetectedClick = function (e) {
        // Restore original values for this window/tab
        appstate.target = kiwixTarget;
        articleWindow = thisWindow;
        articleContainer = thisContainer;
        var isNautilusPopup = a.dataset.popup && !/0|false/i.test(a.dataset.popup);
        if (a.tagName === 'H1' || isNautilusPopup) {
            // We have registered a click on the header or on a dynamic link (e.g. in Nautilus archives)
            if (isNautilusPopup) {
                // Pop-up window sometimes opens out of view, so we have to scroll into view
                iframe.contentWindow.scrollTo({
                    top: '0',
                    behavior: 'smooth'
                });
            }
            if (!a.newcontainer) return; // A new tab wasn't requested, so ignore
        }
        if (params.windowOpener) {
            // This processes Ctrl-click, Command-click, the long-press event, and middle-click
            if (a.newcontainer) {
                // We open the new window immediately so that it is a direct result of user action (click)
                // and we'll populate it later - this avoids most popup blockers
                loadingContainer = true;
                articleContainer = window.open('article.html', params.windowOpener === 'tab' ? '_blank' : a.title,
                    params.windowOpener === 'window' ? 'toolbar=0,location=0,menubar=0,width=800,height=600,resizable=1,scrollbars=1' : null);
                appstate.target = 'window';
                // We have to make this conditional, because sometimes this action is blocked by the browser
                if (articleContainer) {
                    articleContainer.kiwixType = appstate.target;
                    articleWindow = articleContainer;
                }
            }
        }
        e.preventDefault();
        e.stopPropagation();
        anchorParameter = href.match(/#([^#;]+)$/);
        anchorParameter = anchorParameter ? anchorParameter[1] : '';
        var indexRoot = window.location.pathname.replace(/[^\/]+$/, '') + encodeURI(appstate.selectedArchive._file.name) + '/';
        var zimRoot = indexRoot.replace(/^.+?\/www\//, '/');
        var zimUrl;
        var zimUrlFullEncoding;
        if (params.zimType === 'zimit') { 
            if (!href.indexOf(indexRoot)) { // If begins with indexRoot
                zimUrl = href.replace(indexRoot, '').replace('#' + anchorParameter, '');
            } else if (!href.indexOf(zimRoot)) { // If begins with zimRoot
                zimUrl = href.replace(zimRoot, '').replace('#' + anchorParameter, '');
            } else {
                // Zimit ZIMs store URLs percent-encoded and with querystring and
                // deriveZimUrlFromRelativeUrls strips any querystring and decodes
                zimUrl = encodeURI(uiUtil.deriveZimUrlFromRelativeUrl(href, baseUrl)) + 
                    href.replace(encodeURI(uriComponent), '').replace('#' + anchorParameter, '');
                zimUrlFullEncoding = encodeURI(uiUtil.deriveZimUrlFromRelativeUrl(href, baseUrl) + 
                    href.replace(encodeURI(uriComponent), '').replace('#' + anchorParameter, ''));
            }
        } else {
            zimUrl = uiUtil.deriveZimUrlFromRelativeUrl(uriComponent, baseUrl);
        }
        // @TODO: We are getting double activations of the click event. This needs debugging. For now, we use a flag to prevent this.
        a.newcontainer = true; // Prevents double activation
        goToArticle(zimUrl, downloadAttrValue, contentType, zimUrlFullEncoding);
        setTimeout(reset, 1400);
    };
    
    a.addEventListener('touchstart', function (e) {
        if (!params.windowOpener || a.touched) return;
        e.stopPropagation();
        // e.preventDefault();
        a.touched = true;
        loadingContainer = true;
        var event = e;
        // The link will be clicked if the user long-presses for more than 800ms (if the option is enabled)
        setTimeout(function () {
            // DEV: appstate.startVector indicates that the app is processing a touch zoom event, so we cancel any new windows
            // see uiUtil.pointermove_handler
            if (!a.touched || a.newcontainer || appstate.startVector) return;
            e.preventDefault();
            a.newcontainer = true;
            onDetectedClick(event);
        }, 800);
    }, { passive:false });
    a.addEventListener('touchend', function () {
        a.touched = false;
        a.newcontainer = false;
        loadingContainer = false;
    });
    // This detects right-click in all browsers (only if the option is enabled)
    a.addEventListener('contextmenu', function (e) {
        console.debug('contextmenu');
        if (!params.windowOpener) return;
        if (params.rightClickType === 'double' && !a.touched) {
            a.touched = true;
            setTimeout(function () {
                a.touched = false;
            }, 700);
        } else {
            if (a.newcontainer) return; // Prevent accidental double activation
            e.preventDefault();
            e.stopPropagation();
            a.newcontainer = true;
            a.touched = false;
            onDetectedClick(e);
        }
    });
    // This traps the middle-click event before tha auxclick event fires
    a.addEventListener('mousedown', function (e) {
        console.debug('mosuedown');
        if (!params.windowOpener) return;
        e.preventDefault();
        e.stopPropagation();
        if (a.touched || a.newcontainer) return; // Prevent double activations
        if (e.ctrlKey || e.metaKey || e.which === 2 || e.button === 4) {
            a.newcontainer = true;
            onDetectedClick(e);
        } else {
            console.debug('suppressed mousedown');
        }
    });
    // This detects the middle-click event that opens a new tab in recent Firefox and Chrome
    // See https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event
    a.addEventListener('auxclick', function (e) {
        console.debug('auxclick');
        if (!params.windowOpener) return;
        e.preventDefault();
        e.stopPropagation();
    });
    // The main click routine (called by other events above as well)
    a.addEventListener('click', function (e) {
        console.log('Click event', e);
        // Prevent opening multiple windows
        if (loadingContainer || a.touched || a.newcontainer) {
            e.preventDefault();
            e.stopPropagation();
        } else {
            onDetectedClick(e);
        }
    });
}

/**
 * Unhides all hidden divs or tables, for use in Wikimedia mobile display style, which hides some crucial
 * elements that users want optionally to be able to access
 */
function displayHiddenBlockElements(win, doc) {
    if (!doc) return;
    console.debug('Searching for hidden block elements to display...');
    Array.prototype.slice.call(doc.querySelectorAll('table, div')).forEach(function (element) {
        if (win.getComputedStyle(element).display === 'none') {
            element.style.setProperty('display', 'block', 'important');
            if (!params.noHiddenElementsWarning) {
                var message;
                if (!appstate.wikimediaZimLoaded) {
                    message = '<p>The way the <i>Display hidden block elements setting</i> works has changed! Because it is currently set ' +
                    'to <b>always</b>, it will now apply to <i>any</i> ZIM type. This can have unexpected effects in non-Wikipedia ZIMs.</p>' +
                    '<p>We strongly recommend that you change this setting to <b>auto</b> in Configuration. The new auto setting allows the ' +
                    'app to decide when to apply the setting. If you never want to see hidden elements, even in Wikimedia ZIMs, change the ' +
                    'setting to <b>never</b>.</p>';
                }
                // else if (params.displayHiddenBlockElements === 'auto') {  
                //     message =  '<p>There is a new <b>auto</b> setting in Configuration to display hidden elements (navigation boxes, series tables) ' +
                //     "in Wikimedia ZIMs. This is now on by default. If you don't want to see these elements, change the 'Display hidden block elements' " + 
                //     "setting to <b>never</b> (under 'Display style').</p>";
                //     if (params.cssSource !== 'desktop') {
                //         message += '<p>Please note that hidden elements are <i>always</i> displayed in Desktop style (regardless of the setting)' + 
                //         (params.cssSource !== 'desktop' ? '. You can switch the display style to Desktop in Configuration' : '') + '.</p>';
                //     }
                // }
                if (message) {
                    message += '<p><i>This message will not be displayed again, unless you reset the app.</i></p>';
                    params.noHiddenElementsWarning = true;
                    uiUtil.systemAlert(message, 'One-time message!').then(function () {
                        settingsStore.setItem('noHiddenElementsWarning', true, Infinity);
                    });
                }
            }
        }
    });
    // Ensure images are picked up by lazy loading
    win.scrollBy(0, 5);
    win.scrollBy(0, -5);
}

var dropup = document.getElementById('dropup');
dropup.addEventListener('click', function () {
    var ToCList = document.getElementById('ToCList');
    ToCList.style.display = ToCList.style.display === 'block' ? 'none' : 'block';
});

function setupTableOfContents() {
    var iframe = document.getElementById('articleContent');
    var innerDoc = iframe.contentDocument;
    var tableOfContents = new uiUtil.toc(innerDoc);
    var headings = tableOfContents.getHeadingObjects();
    
    dropup.style.fontSize = ~~(params.relativeUIFontSize * 0.14) + "px";
    var dropupHtml = "";
    headings.forEach(function (heading) {
        if (/^h1$/i.test(heading.tagName))
            dropupHtml += '<li style="font-size:' + params.relativeFontSize + '%;"><a href="#" data-heading-id="' + heading.id + '">' + heading.textContent + '</a></li>';
        else if (/^h2$/i.test(heading.tagName))
            dropupHtml += '<li style="font-size:' + ~~(params.relativeFontSize * 0.9) + '%;"><a href="#" data-heading-id="' + heading.id + '">' + heading.textContent + '</a></li>';
        else if (/^h3$/i.test(heading.tagName))
            dropupHtml += '<li style="font-size:' + ~~(params.relativeFontSize * 0.8) + '%;"><a href="#" data-heading-id="' + heading.id + '">' + heading.textContent + '</a></li>';
        else if (/^h4$/i.test(heading.tagName))
            dropupHtml += '<li style="font-size:' + ~~(params.relativeFontSize * 0.7) + '%;"><a href="#" data-heading-id="' + heading.id + '">' + heading.textContent + '</a></li>';
        //Skip smaller headings (if there are any) to avoid making list too long
    });
    var ToCList = document.getElementById('ToCList');
    ToCList.style.maxHeight = ~~(window.innerHeight * 0.75) + 'px';
    ToCList.style.marginLeft = ~~(window.innerWidth / 2) - ~~(window.innerWidth * 0.16) + 'px';
    ToCList.innerHTML = dropupHtml;
    Array.prototype.slice.call(ToCList.getElementsByTagName('a')).forEach(function (listElement) {
        listElement.addEventListener('click', function () {
            var sectionEle = innerDoc.getElementById(this.dataset.headingId);
            var i;
            var csec = util.closest(sectionEle, 'details, section');
            csec = csec && /DETAILS|SECTION/.test(csec.parentElement.tagName) ? csec.parentElement : csec;
            openAllSections(true, csec);
            // Scroll to element
            sectionEle.scrollIntoView();
            // Scrolling up then down ensures that the toolbars show according to user settings
            iframe.contentWindow.scrollBy(0, -5);
            setTimeout(function () {
                iframe.contentWindow.scrollBy(0, 5);
                iframe.contentWindow.focus();
            }, 250);
            ToCList.style.display = 'none';
        });
    });
}

/**
 * Sets the state of collapsible sections for the iframe document, or for the given node
 * @param {Boolean} override An optional value that overrides params.openAllSections (true to open, false to close)
 * @param {Node} node An optional node within which elements will be opened or closed (this will normally be a details element)
 */
// Sets state of collapsible sections
function openAllSections(override, node) {
    var open = override === false ? false : override || params.openAllSections;
    var container = node || articleDocument;
    var blocks = container.querySelectorAll('details, section:not([data-mw-section-id="0"]), .collapsible-block, .collapsible-heading');
    if (node) processSection(open, node);
    for (var x = blocks.length; x--;) {
        processSection(open, blocks[x]);
    }
}

function processSection(open, node) {
    if (/DETAILS|SECTION/.test(node.tagName)) {
        if (open) node.setAttribute('open', '');
        else node.removeAttribute('open');
        if (typeof HTMLDetailsElement === 'undefined' || node.tagName === 'SECTION') {         
            var children = node.children;
            for (var y = children.length; y--;) {
                if (/SUMMARY|H\d/.test(children[y].tagName)) continue;
                if (open) {
                    if (/DETAILS|SECTION/.test(children[y].tagName)) children[y].setAttribute('open', '');
                    children[y].style.removeProperty('display');
                } else {
                    if (/DETAILS|SECTION/.test(children[y].tagName)) children[y].removeAttribute('open');
                    children[y].style.display = 'none';
                }
            }
        }
    } else {
        if (open) node.classList.add('open-block');
        else node.classList.remove('open-block');
    }
}

// Attach listeners to headers to open-close following sections
function setupHeadings() {
    var headings = document.getElementById('articleContent').querySelectorAll('h2, h3, h4, h5');
    for (var i = headings.length; i--;) {
        // Prevent heading from being selected when user clicks on it
        headings[i].style.userSelect = 'none';
        headings[i].style.msUserSelect = 'none';
        headings[i].addEventListener('click', function(e) {
            // Override the built-in simplistic polyfill
            e.preventDefault();
            var that = e.currentTarget;
            var detailsEl = util.closest(that, 'details, section');
            if (detailsEl) {
                var toggle = !detailsEl.hasAttribute('open');
                openAllSections(toggle, detailsEl);
            }
        });
    }
}

params.preloadAllImages = function () {
    if (params.preloadingAllImages !== true) {
        setTimeout(function () {
            if (params.preloadingAllImages) {
                uiUtil.pollSpinner('Extracting images...');
            }
        }, 1000);
        params.preloadingAllImages = true;
        if (params.imageDisplay) params.contentInjectionMode === 'jquery' ?
            images.prepareImagesJQuery(articleWindow, true) : images.prepareImagesServiceWorker(articleWindow, true);
        return;
    }
    // All images should now be loaded, or else user did not request loading images
    uiUtil.clearSpinner();
    uiUtil.extractHTML();
    uiUtil.clearSpinner();
};

// Load Javascript content
function loadJavaScriptJQuery() {
    $('#articleContent').contents().find('script[data-kiwixurl]').each(function () {
        var script = $(this);
        var scriptUrl = script.attr("data-kiwixurl");
        // TODO check that the type of the script is text/javascript or application/javascript
        var title = uiUtil.removeUrlParameters(decodeURIComponent(scriptUrl));
        appstate.selectedArchive.getDirEntryByPath(title).then(function (dirEntry) {
            if (dirEntry === null) {
                console.log("Error: js file not found: " + title);
            } else {
                appstate.selectedArchive.readBinaryFile(dirEntry, function (fileDirEntry, content) {
                    // TODO : JavaScript support not yet functional [kiwix-js #152]
                    uiUtil.feedNodeWithBlob(script, 'src', content, 'text/javascript', params.manipulateImages || params.allowHTMLExtraction);
                });
            }
        }).catch(function (e) {
            console.error("could not find DirEntry for javascript : " + title, e);
        });
    });
}

/**
 * Changes the URL of the browser page, so that the user might go back to it
 * 
 * @param {String} title The title of the article to store (if storing an article)
 * @param {String} titleSearch The title of the search (if storing a search)
 */
function pushBrowserHistoryState(title, titleSearch) {
    // DEV: Note that appstate.target will always be 'iframe' for title searches, so we do not need to account for that
    var targetWin = appstate.target === 'iframe' ? window : articleWindow;
    var stateObj = {};
    var urlParameters;
    var stateLabel;
    if (title && !("" === title)) {
        // Prevents creating a double history for the same page (wrapped to prevent exception in IE and Edge Legacy for tabs)
        try { if (targetWin.history.state && targetWin.history.state.title === title) return; }
        catch (err) { console.error('Unable to access History for this window', err); return; }
        stateObj.title = title;
        urlParameters = "?title=" + title;
        stateLabel = "Wikipedia Article : " + title;
    }
    else if (titleSearch && !("" === titleSearch)) {
        stateObj.titleSearch = titleSearch;
        urlParameters = "?titleSearch=" + titleSearch;
        stateLabel = "Wikipedia search : " + titleSearch;
    }
    else return;
    // Edge Legacy and IE cannot push history state to another window/tab and produce an exception;
    // independent navigation history is therefore disabled for these browsers
    try {
        targetWin.history.pushState(stateObj, stateLabel, urlParameters);
    } catch (error) {
        history.pushState(stateObj, stateLabel, urlParameters);
    }
}

/**
 * Extracts the content of the given article pathname, or a downloadable file, from the ZIM
 * 
 * @param {String} path The pathname (namespace + filename) to the article or file to be extracted
 * @param {Boolean|String} download A Bolean value that will trigger download of title, or the filename that should
 *     be used to save the file in local FS (in HTML5 spec, a string value for the download attribute is optional)
 * @param {String} contentType The mimetype of the downloadable file, if known
 * @param {String} pathEnc The fully encoded version of the path for use with some Zimit archives
 */
function goToArticle(path, download, contentType, pathEnc) {
    var pathForServiceWorker = path;
    path = path.replace(/\??isKiwixHref/, '');
    appstate.expectedArticleURLToBeDisplayed = path;
    //This removes any search highlighting
    clearFindInArticle();
    var shortTitle = path.replace(/[^/]+\//g, '').substring(0, 18);
    uiUtil.pollSpinner('Loading ' + shortTitle);
    var zimName = appstate.selectedArchive._file.name.replace(/\.[^.]+$/, '').replace(/_\d+-\d+$/, '');
    if (~path.indexOf(params.cachedStartPages[zimName])) {
        goToMainArticle();
        return;
    }
    appstate.selectedArchive.getDirEntryByPath(path).then(function (dirEntry) {
        var mimetype = contentType || dirEntry ? dirEntry.getMimetype() : '';
        if (dirEntry === null || dirEntry === undefined) {
            uiUtil.clearSpinner();
            console.error("Article with title " + path + " not found in the archive");
            if (params.zimType === 'zimit') {
                if (pathEnc) {
                    // We failed to get path, so we should try the fully encoded version instead
                    goToArticle(pathEnc, download, contentType);
                } else {
                    var anchor = {
                        href: path.replace(/^(C\/)?A\//, ''),
                        target: '_blank'
                    };
                    uiUtil.warnAndOpenExternalLinkInNewTab(null, anchor)
                    setTab();
                }
            } else {
                uiUtil.systemAlert('<p>Sorry, but we couldn\'t find the article:</p><p><i>' + path + '</i></p><p>in this archive!</p>');
            }
        } else if (download || /\/(epub|pdf|zip|.*opendocument|.*officedocument|tiff|mp4|webm|mpeg|octet-stream)\b/i.test(mimetype)) {
            // PDFs can be treated as a special case, as they can be displayed directly in a browser window or tab in most browsers (but not UWP)
            if (!/UWP/.test(params.appType) && params.contentInjectionMode === 'serviceworker' && (/\/pdf\b/.test(mimetype) || /\.pdf([?#]|$)/i.test(dirEntry.url))) {
                window.open(document.location.pathname.replace(/[^/]+$/, '') + appstate.selectedArchive._file.name + '/' + pathForServiceWorker,
                    params.windowOpener === 'tab' ? '_blank' : 'Download PDF',
                    params.windowOpener === 'window' ? 'toolbar=0,location=0,menubar=0,width=800,height=600,resizable=1,scrollbars=1' : null);
            } else {
                download = true;
                appstate.selectedArchive.readBinaryFile(dirEntry, function (fileDirEntry, content) {
                    uiUtil.displayFileDownloadAlert(path, download, mimetype, content);
                    uiUtil.clearSpinner();
                });
            }
        } else {
            // params.isLandingPage = false;
            $('.alert').hide();
            readArticle(dirEntry);
        }
    }).catch(function (e) {
        console.error("Error reading article with title " + path, e);
        if (params.appIsLaunching) goToMainArticle();
        // Line below prevents bootloop
        params.appIsLaunching = false;
    });
}

function goToRandomArticle() {
    if (appstate.selectedArchive !== null && appstate.selectedArchive.isReady()) {
        uiUtil.pollSpinner();
        appstate.selectedArchive.getRandomDirEntry(function (dirEntry) {
            if (dirEntry === null || dirEntry === undefined) {
                uiUtil.clearSpinner();
                uiUtil.systemAlert('Error finding random article', 'Error finding article');
            } else {
                // We fall back to the old A namespace to support old ZIM files without a text/html MIME type for articles
                // DEV: If minorVersion is 1, then we are using a v1 article-only title listing. By definition,
                // all dirEntries in an article-only listing must be articles.
                if (appstate.selectedArchive._file.minorVersion === 1 || /text\/html\b/i.test(dirEntry.getMimetype()) || 
                    params.zimType !== 'zimit' && dirEntry.namespace === 'A') {
                    params.isLandingPage = false;
                    alertBoxHeader.style.display = 'none';
                    readArticle(dirEntry);
                } else {
                    // If the random title search did not end up on an article,
                    // we try again, until we find one
                    goToRandomArticle();
                }
            }
        });
    } else {
        // Showing the relavant error message and redirecting to config page for adding the ZIM file
        uiUtil.systemAlert('Archive not set: please select an archive', 'No archive selected').then(function () {
            document.getElementById('btnConfigure').click();
        });
    }
}

function goToMainArticle() {
    uiUtil.pollSpinner();
    params.isLandingPage = true;
    appstate.selectedArchive.getMainPageDirEntry(function (dirEntry) {
        if (dirEntry === null || dirEntry === undefined) {
            params.isLandingPage = false;
            console.error("Error finding main article.");
            uiUtil.clearSpinner();
            document.getElementById('welcomeText').style.display = '';
            uiUtil.systemAlert('We cannot find the landing page!<br />' + 
                    'Please check that this ZIM archive is valid. You may be able to search for other pages in the ZIM above.',
                    'Main page not found!');
        } else {
            // DEV: see comment above under goToRandomArticle()
            if (dirEntry.redirect || /text/.test(dirEntry.getMimetype()) || dirEntry.namespace === 'A') {
                params.isLandingPage = true;
                appstate.selectedArchive.landingPageUrl = dirEntry.namespace + '/' + dirEntry.url;
                readArticle(dirEntry);
            } else {
                params.isLandingPage = false;
                console.error("The main page of this archive does not seem to be an article");
                uiUtil.clearSpinner();
                document.getElementById('welcomeText').style.display = '';
                uiUtil.systemAlert('The main page of this archive does not seem to be an article!<br />' + 
                    'Please check that this ZIM archive is valid. You may be able to search for other pages in the ZIM above.',
                    'Invalid article!');
            }
        }
    });
}

export default {};
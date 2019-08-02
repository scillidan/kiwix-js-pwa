﻿/**
 * init.js : Configuration for the library require.js
 * This file handles the dependencies between javascript libraries
 * 
 * Copyright 2013-2018 Mossroy and contributors
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

// Set a global error handler to prevent app crashes
window.onerror = function (msg, url) {
    console.error('Error caught in app [' + url + ']:\n', msg);
    return true;
};
// State variables that are needed across different modules
var state = {};
// Parameters that define overall operation of app
var params = {};
params['version'] = "0.9.9.92 Beta-dev"; //DEV: do not set this dynamically -- it is compared to the cookie "version" in order to show first-time info, and the cookie is updated in app.js
params['packagedFile'] = "wikipedia_en_100.zim"; //For packaged Kiwix JS (e.g. with Wikivoyage file), set this to the filename (for split files, give the first chunk *.zimaa) and place file(s) in default storage
params['archivePath'] = "archives"; //The directory containing the packaged archive(s) (relative to www/index.html)  
params['fileVersion'] = "wikipedia_en_100_2019-01 (Jan-2019)"; //Use generic name for actual file, and give version here
params['cachedStartPage'] = "index.htm"; //If you have cached the start page for quick start, give its URI here
params['kiwixDownloadLink'] = "https://download.kiwix.org/zim/"; //Include final slash

params['results'] = params['results'] || 50; //Number of search results to display
params['relativeFontSize'] = ~~(getCookie('relativeFontSize') || 100); //Sets the initial font size for articles (as a percentage) - user can adjust using zoom buttons
params['relativeUIFontSize'] = ~~(getCookie('relativeUIFontSize') || 100); //Sets the initial font size for UI (as a percentage) - user can adjust using slider in Config
params['cssSource'] = getCookie('cssSource') || "auto"; //Set default to "auto", "desktop" or "mobile"
params['removePageMaxWidth'] = getCookie('removePageMaxWidth') != null ? getCookie('removePageMaxWidth') : "auto"; //Set default for removing max-width restriction on Wikimedia pages ("auto" = removed in desktop, not in mobile; true = always remove; false = never remove)
params['openAllSections'] = getCookie('openAllSections') != null ? getCookie('openAllSections') : true; //Set default for opening all sections in ZIMs that have collapsible sections and headings ("auto" = let CSS decide according to screen width; true = always open until clicked by user; false = always closed until clicked by user)
params['cssCache'] = getCookie('cssCache') != null ? getCookie('cssCache') : true; //Set default to true to use cached CSS, false to use Zim only
params['cssTheme'] = getCookie('cssTheme') || 'light'; //Set default to 'auto', 'light', 'dark' or 'invert' to use respective themes for articles
params['cssUITheme'] = getCookie('cssUITheme') || 'light'; //Set default to 'auto', 'light' or 'dark' to use respective themes for UI
params['imageDisplay'] = getCookie('imageDisplay') != null ? getCookie('imageDisplay') : true; //Set default to display images from Zim
params['hideToolbar'] = getCookie('hideToolbar') != null ? getCookie('hideToolbar') : false; //Set default to hide the top toolbar on scroll
params['rememberLastPage'] = getCookie('rememberLastPage') != null ? getCookie('rememberLastPage') : true; //Set default option to remember the last visited page between sessions
params['useMathJax'] = getCookie('useMathJax') != null ? getCookie('useMathJax') : true; //Set default to true to display math formulae with MathJax, false to use fallback SVG images only
//params['showFileSelectors'] = getCookie('showFileSelectors') != null ? getCookie('showFileSelectors') : false; //Set to true to display hidden file selectors in packaged apps
params['showFileSelectors'] = true; //False will cause file selectors to be hidden on each load of the app (by ignoring cookie)
params['hideActiveContentWarning'] = getCookie('hideActiveContentWarning') != null ? getCookie('hideActiveContentWarning') : false;
params['allowHTMLExtraction'] = getCookie('allowHTMLExtraction') == true;
params['alphaChar'] = getCookie('alphaChar') || 'A'; //Set default start of alphabet string (used by the Archive Index)
params['omegaChar'] = getCookie('omegaChar') || 'Z'; //Set default end of alphabet string
params['contentInjectionMode'] = getCookie('contentInjectionMode') || 'jquery'; //Defaults to jquery mode (widest compatibility)

//Do not touch these values unless you know what they do! Some are global variables, some are set programmatically
params['imageDisplayMode'] = params.imageDisplay ? 'progressive' : 'manual';
params['storedFile'] = getCookie('lastSelectedArchive') || params['packagedFile'];
params.storedFile = launchArguments ? launchArguments.files[0].name : params.storedFile;
params['storedFilePath'] = getCookie('lastSelectedArchivePath');
params.storedFilePath = params.storedFilePath ? decodeURIComponent(params.storedFilePath) : params.archivePath + '/' + params.packagedFile;
params.storedFilePath = launchArguments ? launchArguments.files[0].path || '' :  params.storedFilePath;
params['falFileToken'] = params['falFileToken'] || "zimfile"; //UWP support
params['falFolderToken'] = params['falFolderToken'] || "zimfilestore"; //UWP support
params['localStorage'] = params['localStorage'] || "";
params['pickedFile'] = launchArguments ? launchArguments.files[0] : "";
params['pickedFolder'] = params['pickedFolder'] || "";
params['lastPageVisit'] = getCookie('lastPageVisit') || "";
params['lastPageVisit'] = params['lastPageVisit'] ? decodeURIComponent(params['lastPageVisit']) : "";
params['themeChanged'] = params['themeChanged'] || false;
params['allowInternetAccess'] = params['allowInternetAccess'] || false; //Do not get value from cookie, should be explicitly set by user on a per-session basis
params['printIntercept'] = false;
params['printInterception'] = false;
params['appIsLaunching'] = true; //Allows some routines to tell if the app has just been launched

//Prevent app boot loop with problematic pages that cause an app crash
if (getCookie('lastPageLoad') == 'failed') {
    params.lastPageVisit = "";
} else {
    //Cookie will signal failure until article is fully loaded
    document.cookie = 'lastPageLoad=failed;expires=Fri, 31 Dec 9999 23:59:59 GMT';
}

//Initialize checkbox, radio and other values
document.getElementById('cssCacheModeCheck').checked = params.cssCache;
document.getElementById('imageDisplayModeCheck').checked = params.imageDisplay;
document.getElementById('removePageMaxWidthCheck').checked = params.removePageMaxWidth === true; // Will be false if false or auto
document.getElementById('removePageMaxWidthCheck').indeterminate = params.removePageMaxWidth == "auto";
document.getElementById('removePageMaxWidthCheck').readOnly = params.removePageMaxWidth == "auto";
document.getElementById('pageMaxWidthState').innerHTML = (params.removePageMaxWidth == "auto" ? "auto" : params.removePageMaxWidth ? "always" : "never");
document.getElementById('hideToolbarCheck').checked = params.hideToolbar;
document.getElementById('cssUIDarkThemeCheck').checked = params.cssUITheme == "dark"; // Will be true, or false if light or auto
document.getElementById('cssUIDarkThemeCheck').indeterminate = params.cssUITheme == "auto";
document.getElementById('cssUIDarkThemeCheck').readOnly = params.cssUITheme == "auto";
document.getElementById('cssUIDarkThemeState').innerHTML = params.cssUITheme;
document.getElementById('cssWikiDarkThemeCheck').checked = /dark|invert/.test(params.cssTheme);
document.getElementById('cssWikiDarkThemeCheck').indeterminate = params.cssTheme == "auto";
document.getElementById('cssWikiDarkThemeCheck').readOnly = params.cssTheme == "auto";
document.getElementById('cssWikiDarkThemeState').innerHTML = params.cssTheme;
document.getElementById('darkInvert').style.display = /dark|invert/i.test(params.cssTheme) ? "inline" : "none";
document.getElementById('cssWikiDarkThemeInvertCheck').checked = params.cssTheme == 'invert';
document.getElementById('useMathJaxRadio' + (params.useMathJax ? 'True' : 'False')).checked = true;
document.getElementById('rememberLastPageCheck').checked = params.rememberLastPage;
document.getElementById('displayFileSelectorsCheck').checked = params.showFileSelectors;
document.getElementById('hideActiveContentWarningCheck').checked = params.hideActiveContentWarning;
document.getElementById('allowHTMLExtractionCheck').checked = params.allowHTMLExtraction;
document.getElementById('alphaCharTxt').value = params.alphaChar;
document.getElementById('omegaCharTxt').value = params.omegaChar;

var versionSpans = document.getElementsByClassName('version');
for (var i = 0; i < versionSpans.length; i++) {
    versionSpans[i].innerHTML = i ? params.version : params.version.replace(/\s+.*$/, "");
}
var fileVersionDivs = document.getElementsByClassName('fileVersion');
for (i = 0; i < fileVersionDivs.length; i++) {
    fileVersionDivs[i].innerHTML = i ? params.fileVersion.replace(/\s+.+$/, "") : params.fileVersion;
}
document.getElementById('logUpdate').innerHTML = document.getElementById('update').innerHTML.match(/<ul[^>]*>[\s\S]+/i);
document.getElementById('logFeatures').innerHTML = document.getElementById('features').innerHTML;

//Set up packaged Electron app
if (!params.pickedFile && params.storedFile && typeof window.fs !== 'undefined') {
    params.pickedFile = params.packagedFile;
}
//Set up storage types
if (params.storedFile && typeof Windows !== 'undefined' && typeof Windows.Storage !== 'undefined') { //UWP
    //DEV change "archives" below if you wish to store local archives in a different location in the installation package
    Windows.ApplicationModel.Package.current.installedLocation.getFolderAsync("archives").done(function (folder) {
        if (folder) params.localStorage = folder;
    }, function (err) {
        console.error("This app doesn't appear to have access to local storage!");
    });
    var futureAccessList = Windows.Storage.AccessCache.StorageApplicationPermissions.futureAccessList;
    if (futureAccessList.containsItem(params.falFolderToken)) {
        futureAccessList.getFolderAsync(params.falFolderToken).then(function (folder) {
            if (folder) params.pickedFolder = folder;
        }, function (err) {
            console.error("The previously picked folder is no longer accessible: " + err.message);
        });
    }
    //If we don't already have a picked file (e.g. by launching app with click on a ZIM file), then retrieve it from futureAccessList if possible
    var listOfArchives = getCookie('listOfArchives');
    // But don't get the picked file if we already have access to the folder and the file is in it!
    if (listOfArchives && ~listOfArchives.indexOf(params.storedFile) && params.pickedFolder) {
        params.pickedFile = '';
    } else {
        if (!params.pickedFile && futureAccessList.containsItem(params.falFileToken)) {
            params.pickedFile = '';
            futureAccessList.getFileAsync(params.falFileToken).done(function (file) {
                if (file && file.name === params.storedFile) params.pickedFile = file;
            }, function (err) {
                console.error("The previously picked file is no longer accessible: " + err.message);
            });
        }
    }
}

function getCookie(name) {
    var regexp = new RegExp('(?:^|;)\\s*' + name + '=([^;]+)(?:;|$)');
    var result = document.cookie.match(regexp);
    return result === null || result[1] == "undefined" ? null : result[1] == "true" ? true : result[1] == "false" ? false : result[1];
}

require.config({
    //enforceDefine: true, //This is for debugging IE errors
    baseUrl: 'js/lib',
    config: { '../app': { params: params } },
    paths: {
        'jquery': 'jquery-3.2.1.slim',
        //'jquery': 'jquery-3.2.1',
        //'bootstrap': 'bootstrap'
        'bootstrap': 'bootstrap.min'
    },
    shim: {
        'jquery': {
            exports: '$'
        },
        'bootstrap': {
            deps: ['jquery']
        }
    }
});

define(['bootstrap','../app']);

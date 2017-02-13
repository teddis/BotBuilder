// 
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
// 
// Microsoft Bot Framework: http://botframework.com
// 
// Bot Builder SDK Github:
// https://github.com/Microsoft/BotBuilder
// 
// Copyright (c) Microsoft Corporation
// All rights reserved.
// 
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
// 
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
"use strict";
var da = require('../dialogs/DialogAction');
var sd = require('../dialogs/SimpleDialog');
var consts = require('../consts');
var path = require('path');
var Library = (function () {
    function Library(name) {
        this.name = name;
        this.dialogs = {};
        this.libraries = {};
    }
    Library.prototype.localePath = function (path) {
        if (path) {
            this._localePath = path;
        }
        return this._localePath;
    };
    Library.prototype.dialog = function (id, dialog) {
        var d;
        if (dialog) {
            // Fixup id
            if (id.indexOf(':') >= 0) {
                id = id.split(':')[1];
            }
            // Ensure unique
            if (this.dialogs.hasOwnProperty(id)) {
                throw new Error("Dialog[" + id + "] already exists in library[" + this.name + "].");
            }
            // Wrap dialog and save
            if (Array.isArray(dialog)) {
                d = new sd.SimpleDialog(da.waterfall(dialog));
            }
            else if (typeof dialog == 'function') {
                d = new sd.SimpleDialog(da.waterfall([dialog]));
            }
            else {
                d = dialog;
            }
            this.dialogs[id] = d;
        }
        else if (this.dialogs.hasOwnProperty(id)) {
            d = this.dialogs[id];
        }
        return d;
    };
    Library.prototype.library = function (lib) {
        var l;
        if (typeof lib === 'string') {
            if (lib == this.name) {
                l = this;
            }
            else if (this.libraries.hasOwnProperty(lib)) {
                l = this.libraries[lib];
            }
            else {
                // Search for lib
                for (var name in this.libraries) {
                    l = this.libraries[name].library(lib);
                    if (l) {
                        break;
                    }
                }
            }
        }
        else {
            // Save library
            l = this.libraries[lib.name] = lib;
        }
        return l;
    };
    Library.prototype.findDialog = function (libName, dialogId) {
        var d;
        var lib = this.library(libName);
        if (lib) {
            d = lib.dialog(dialogId);
        }
        return d;
    };
    Library.prototype.forEachLibrary = function (callback) {
        for (var lib in this.libraries) {
            callback(this.libraries[lib]);
        }
    };
    return Library;
}());
exports.Library = Library;
exports.systemLib = new Library(consts.Library.system);
exports.systemLib.localePath(path.join(__dirname, '../locale/'));

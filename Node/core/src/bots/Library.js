"use strict";
const da = require('../dialogs/DialogAction');
const sd = require('../dialogs/SimpleDialog');
const consts = require('../consts');
const path = require('path');
class Library {
    constructor(name) {
        this.name = name;
        this.dialogs = {};
        this.libraries = {};
    }
    localePath(path) {
        if (path) {
            this._localePath = path;
        }
        return this._localePath;
    }
    dialog(id, dialog) {
        var d;
        if (dialog) {
            if (id.indexOf(':') >= 0) {
                id = id.split(':')[1];
            }
            if (this.dialogs.hasOwnProperty(id)) {
                throw new Error("Dialog[" + id + "] already exists in library[" + this.name + "].");
            }
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
    }
    library(lib) {
        var l;
        if (typeof lib === 'string') {
            if (lib == this.name) {
                l = this;
            }
            else if (this.libraries.hasOwnProperty(lib)) {
                l = this.libraries[lib];
            }
            else {
                for (var name in this.libraries) {
                    l = this.libraries[name].library(lib);
                    if (l) {
                        break;
                    }
                }
            }
        }
        else {
            l = this.libraries[lib.name] = lib;
        }
        return l;
    }
    findDialog(libName, dialogId) {
        var d;
        var lib = this.library(libName);
        if (lib) {
            d = lib.dialog(dialogId);
        }
        return d;
    }
    forEachLibrary(callback) {
        for (var lib in this.libraries) {
            callback(this.libraries[lib]);
        }
    }
}
exports.Library = Library;
exports.systemLib = new Library(consts.Library.system);
exports.systemLib.localePath(path.join(__dirname, '../locale/'));
//# sourceMappingURL=Library.js.map
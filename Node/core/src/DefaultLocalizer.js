"use strict";
const fs = require('fs');
const async = require('async');
const Promise = require('promise');
const path = require('path');
const logger = require('./logger');
class DefaultLocalizer {
    constructor(root, defaultLocale) {
        this.localePaths = [];
        this.locales = {};
        this.defaultLocale(defaultLocale || 'en');
        var libsSeen = {};
        var _that = this;
        function addPaths(library) {
            if (!libsSeen.hasOwnProperty(library.name)) {
                libsSeen[library.name] = true;
                library.forEachLibrary((child) => {
                    addPaths(child);
                });
                var path = library.localePath();
                if (path) {
                    _that.localePaths.push(path);
                }
            }
        }
        addPaths(root);
    }
    defaultLocale(locale) {
        if (locale) {
            this._defaultLocale = locale.toLowerCase();
        }
        else {
            return this._defaultLocale;
        }
    }
    load(locale, done) {
        logger.debug("localizer.load(%s)", locale);
        locale = locale ? locale.toLowerCase() : this._defaultLocale;
        var fbDefault = this.getFallback(this._defaultLocale);
        var fbLocale = this.getFallback(locale);
        var locales = ['en'];
        if (fbDefault !== 'en') {
            locales.push(fbDefault);
        }
        if (this._defaultLocale !== fbDefault) {
            locales.push(this._defaultLocale);
        }
        if (fbLocale !== fbDefault) {
            locales.push(fbLocale);
        }
        if (locale !== fbLocale) {
            locales.push(locale);
        }
        async.each(locales, (locale, cb) => {
            this.loadLocale(locale).done(() => cb(), (err) => cb(err));
        }, (err) => {
            if (done) {
                done(err);
            }
        });
    }
    trygettext(locale, msgid, ns) {
        locale = locale ? locale.toLowerCase() : this._defaultLocale;
        var fbDefault = this.getFallback(this._defaultLocale);
        var fbLocale = this.getFallback(locale);
        ns = ns ? ns.toLocaleLowerCase() : null;
        var key = this.createKey(ns, msgid);
        var text = this.getEntry(locale, key);
        if (!text && fbLocale !== locale) {
            text = this.getEntry(fbLocale, key);
        }
        if (!text && this._defaultLocale !== locale) {
            text = this.getEntry(this._defaultLocale, key);
        }
        if (!text && fbDefault !== this._defaultLocale) {
            text = this.getEntry(fbDefault, key);
        }
        return text ? this.getValue(text) : null;
    }
    gettext(locale, msgid, ns) {
        return this.trygettext(locale, msgid, ns) || msgid;
    }
    ngettext(locale, msgid, msgid_plural, count, ns) {
        return count == 1 ? this.gettext(locale, msgid, ns) : this.gettext(locale, msgid_plural, ns);
    }
    getFallback(locale) {
        if (locale) {
            var split = locale.indexOf("-");
            if (split != -1) {
                return locale.substring(0, split);
            }
        }
        return this.defaultLocale();
    }
    loadLocale(locale) {
        if (!this.locales.hasOwnProperty(locale)) {
            var entry;
            this.locales[locale] = entry = { loaded: null, entries: {} };
            entry.loaded = new Promise((resolve, reject) => {
                async.eachSeries(this.localePaths, (path, cb) => {
                    this.loadLocalePath(locale, path).done(() => cb(), (err) => cb(err));
                }, (err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(true);
                    }
                });
            });
        }
        return this.locales[locale].loaded;
    }
    loadLocalePath(locale, localePath) {
        var dir = path.join(localePath, locale);
        var entryCount = 0;
        var p = new Promise((resolve, reject) => {
            var access = Promise.denodeify(fs.access);
            var readdir = Promise.denodeify(fs.readdir);
            var asyncEach = Promise.denodeify(async.each);
            access(dir)
                .then(() => {
                return readdir(dir);
            })
                .then((files) => {
                return asyncEach(files, (file, cb) => {
                    if (file.substring(file.length - 5).toLowerCase() == ".json") {
                        logger.debug("localizer.load(%s) - Loading %s/%s", locale, dir, file);
                        this.parseFile(locale, dir, file)
                            .then((count) => {
                            entryCount += count;
                            cb();
                        }, (err) => {
                            logger.error("localizer.load(%s) - Error reading %s/%s: %s", locale, dir, file, err.toString());
                            cb();
                        });
                    }
                    else {
                        cb();
                    }
                });
            })
                .then(() => {
                resolve(entryCount);
            }, (err) => {
                if (err.code === 'ENOENT') {
                    logger.debug("localizer.load(%s) - Couldn't find directory: %s", locale, dir);
                    resolve(-1);
                }
                else {
                    logger.error('localizer.load(%s) - Error: %s', locale, err.toString());
                    reject(err);
                }
            });
        });
        return p;
    }
    parseFile(locale, localeDir, filename) {
        var table = this.locales[locale];
        return new Promise((resolve, reject) => {
            var filePath = path.join(localeDir, filename);
            var readFile = Promise.denodeify(fs.readFile);
            readFile(filePath, 'utf8')
                .then((data) => {
                var ns = path.parse(filename).name;
                if (ns == 'index') {
                    ns = null;
                }
                try {
                    var cnt = 0;
                    var entries = JSON.parse(data);
                    for (var key in entries) {
                        var k = this.createKey(ns, key);
                        table.entries[k] = entries[key];
                        ++cnt;
                    }
                    resolve(cnt);
                }
                catch (error) {
                    return reject(error);
                }
            }, (err) => {
                reject(err);
            });
        });
    }
    createKey(ns, msgid) {
        var escapedMsgId = this.escapeKey(msgid);
        var prepend = "";
        if (ns) {
            prepend = ns + ":";
        }
        return prepend + msgid;
    }
    escapeKey(key) {
        return key.replace(/:/g, "--").toLowerCase();
    }
    getEntry(locale, key) {
        return this.locales.hasOwnProperty(locale) && this.locales[locale].entries.hasOwnProperty(key) ? this.locales[locale].entries[key] : null;
    }
    getValue(text) {
        return typeof text == "string" ? text : this.randomizeValue(text);
    }
    randomizeValue(a) {
        var i = Math.floor(Math.random() * a.length);
        return this.getValue(a[i]);
    }
}
exports.DefaultLocalizer = DefaultLocalizer;
//# sourceMappingURL=DefaultLocalizer.js.map
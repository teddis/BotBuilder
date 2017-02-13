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
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var dl = require('./Library');
var actions = require('../dialogs/ActionSet');
var ses = require('../Session');
var bs = require('../storage/BotStorage');
var consts = require('../consts');
var utils = require('../utils');
var async = require('async');
var events = require('events');
var DefaultLocalizer_1 = require('../DefaultLocalizer');
var UniversalBot = (function (_super) {
    __extends(UniversalBot, _super);
    function UniversalBot(connector, settings) {
        _super.call(this);
        this.settings = {
            processLimit: 4,
            persistUserData: true,
            persistConversationData: false
        };
        this.connectors = {};
        this.lib = new dl.Library(consts.Library.default);
        this.actions = new actions.ActionSet();
        this.mwReceive = [];
        this.mwSend = [];
        this.mwSession = [];
        this.lib.localePath('./locale/');
        this.lib.library(dl.systemLib);
        if (settings) {
            for (var name in settings) {
                if (settings.hasOwnProperty(name)) {
                    this.set(name, settings[name]);
                }
            }
        }
        if (connector) {
            this.connector(consts.defaultConnector, connector);
        }
    }
    //-------------------------------------------------------------------------
    // Settings
    //-------------------------------------------------------------------------
    UniversalBot.prototype.set = function (name, value) {
        this.settings[name] = value;
        if (value && name === 'localizerSettings') {
            var settings = value;
            if (settings.botLocalePath) {
                this.lib.localePath(settings.botLocalePath);
            }
        }
        return this;
    };
    UniversalBot.prototype.get = function (name) {
        return this.settings[name];
    };
    //-------------------------------------------------------------------------
    // Connectors
    //-------------------------------------------------------------------------
    UniversalBot.prototype.connector = function (channelId, connector) {
        var _this = this;
        var c;
        if (connector) {
            // Bind to connector.
            this.connectors[channelId || consts.defaultConnector] = c = connector;
            c.onEvent(function (events, cb) { return _this.receive(events, cb); });
            // Optionally use connector for storage.
            var asStorage = connector;
            if (!this.settings.storage &&
                typeof asStorage.getData === 'function' &&
                typeof asStorage.saveData === 'function') {
                this.settings.storage = asStorage;
            }
        }
        else if (this.connectors.hasOwnProperty(channelId)) {
            c = this.connectors[channelId];
        }
        else if (this.connectors.hasOwnProperty(consts.defaultConnector)) {
            c = this.connectors[consts.defaultConnector];
        }
        return c;
    };
    //-------------------------------------------------------------------------
    // Library Management
    //-------------------------------------------------------------------------
    UniversalBot.prototype.dialog = function (id, dialog) {
        return this.lib.dialog(id, dialog);
    };
    UniversalBot.prototype.library = function (lib) {
        return this.lib.library(lib);
    };
    //-------------------------------------------------------------------------
    // Middleware
    //-------------------------------------------------------------------------
    UniversalBot.prototype.use = function () {
        var _this = this;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i - 0] = arguments[_i];
        }
        args.forEach(function (mw) {
            var added = 0;
            if (mw.receive) {
                Array.prototype.push.apply(_this.mwReceive, Array.isArray(mw.receive) ? mw.receive : [mw.receive]);
                added++;
            }
            if (mw.send) {
                Array.prototype.push.apply(_this.mwSend, Array.isArray(mw.send) ? mw.send : [mw.send]);
                added++;
            }
            if (mw.botbuilder) {
                Array.prototype.push.apply(_this.mwSession, Array.isArray(mw.botbuilder) ? mw.botbuilder : [mw.botbuilder]);
                added++;
            }
            if (added < 1) {
                console.warn('UniversalBot.use: no compatible middleware hook found to install.');
            }
        });
        return this;
    };
    //-------------------------------------------------------------------------
    // Actions
    //-------------------------------------------------------------------------
    UniversalBot.prototype.beginDialogAction = function (name, id, options) {
        this.actions.beginDialogAction(name, id, options);
        return this;
    };
    UniversalBot.prototype.endConversationAction = function (name, msg, options) {
        this.actions.endConversationAction(name, msg, options);
        return this;
    };
    //-------------------------------------------------------------------------
    // Messaging
    //-------------------------------------------------------------------------
    UniversalBot.prototype.receive = function (events, done) {
        var _this = this;
        var list = Array.isArray(events) ? events : [events];
        async.eachLimit(list, this.settings.processLimit, function (message, cb) {
            message.agent = consts.agent;
            message.type = message.type || consts.messageType;
            _this.lookupUser(message.address, function (user) {
                if (user) {
                    message.user = user;
                }
                _this.emit('receive', message);
                _this.eventMiddleware(message, _this.mwReceive, function () {
                    if (_this.isMessage(message)) {
                        _this.emit('incoming', message);
                        var userId = message.user.id;
                        var conversationId = message.address.conversation ? message.address.conversation.id : null;
                        var storageCtx = {
                            userId: userId,
                            conversationId: conversationId,
                            address: message.address,
                            persistUserData: _this.settings.persistUserData,
                            persistConversationData: _this.settings.persistConversationData
                        };
                        _this.route(storageCtx, message, _this.settings.defaultDialogId || '/', _this.settings.defaultDialogArgs, cb);
                    }
                    else {
                        // Dispatch incoming activity
                        _this.emit(message.type, message);
                        cb(null);
                    }
                }, cb);
            }, cb);
        }, this.errorLogger(done));
    };
    UniversalBot.prototype.beginDialog = function (address, dialogId, dialogArgs, done) {
        var _this = this;
        this.lookupUser(address, function (user) {
            var msg = {
                type: consts.messageType,
                agent: consts.agent,
                source: address.channelId,
                sourceEvent: {},
                address: utils.clone(address),
                text: '',
                user: user
            };
            _this.ensureConversation(msg.address, function (adr) {
                msg.address = adr;
                var conversationId = msg.address.conversation ? msg.address.conversation.id : null;
                var storageCtx = {
                    userId: msg.user.id,
                    conversationId: conversationId,
                    address: msg.address,
                    persistUserData: _this.settings.persistUserData,
                    persistConversationData: _this.settings.persistConversationData
                };
                _this.route(storageCtx, msg, dialogId, dialogArgs, _this.errorLogger(done), true);
            }, _this.errorLogger(done));
        }, this.errorLogger(done));
    };
    UniversalBot.prototype.send = function (messages, done) {
        var _this = this;
        var list;
        if (Array.isArray(messages)) {
            list = messages;
        }
        else if (messages.toMessage) {
            list = [messages.toMessage()];
        }
        else {
            list = [messages];
        }
        async.eachLimit(list, this.settings.processLimit, function (message, cb) {
            _this.ensureConversation(message.address, function (adr) {
                message.address = adr;
                _this.emit('send', message);
                _this.eventMiddleware(message, _this.mwSend, function () {
                    _this.emit('outgoing', message);
                    cb(null);
                }, cb);
            }, cb);
        }, this.errorLogger(function (err) {
            if (!err) {
                _this.tryCatch(function () {
                    // All messages should be targeted at the same channel.
                    var channelId = list[0].address.channelId;
                    var connector = _this.connector(channelId);
                    if (!connector) {
                        throw new Error("Invalid channelId='" + channelId + "'");
                    }
                    connector.send(list, _this.errorLogger(done));
                }, _this.errorLogger(done));
            }
            else if (done) {
                done(null);
            }
        }));
    };
    UniversalBot.prototype.isInConversation = function (address, cb) {
        var _this = this;
        this.lookupUser(address, function (user) {
            var conversationId = address.conversation ? address.conversation.id : null;
            var storageCtx = {
                userId: user.id,
                conversationId: conversationId,
                address: address,
                persistUserData: false,
                persistConversationData: false
            };
            _this.getStorageData(storageCtx, function (data) {
                var lastAccess;
                if (data && data.privateConversationData && data.privateConversationData.hasOwnProperty(consts.Data.SessionState)) {
                    var ss = data.privateConversationData[consts.Data.SessionState];
                    if (ss && ss.lastAccess) {
                        lastAccess = new Date(ss.lastAccess);
                    }
                }
                cb(null, lastAccess);
            }, _this.errorLogger(cb));
        }, this.errorLogger(cb));
    };
    //-------------------------------------------------------------------------
    // Helpers
    //-------------------------------------------------------------------------
    UniversalBot.prototype.route = function (storageCtx, message, dialogId, dialogArgs, done, newStack) {
        var _this = this;
        if (newStack === void 0) { newStack = false; }
        // --------------------------------------------------------------------
        // Theory of Operation
        // --------------------------------------------------------------------
        // The route() function is called for both reactive & pro-active 
        // messages and while they generally work the same there are some 
        // differences worth noting.
        //
        // REACTIVE:
        // * The passed in storageKey will have the normalized userId and the
        //   conversationId for the incoming message. These are used as keys to
        //   load the persisted userData and conversationData objects.
        // * After loading data from storage we create a new Session object and
        //   dispatch the incoming message to the active dialog.
        // * As part of the normal dialog flow the session will call onSave() 1 
        //   or more times before each call to onSend().  Anytime onSave() is 
        //   called we'll save the current userData & conversationData objects
        //   to storage.
        //
        // PROACTIVE:
        // * Proactive follows essentially the same flow but the difference is 
        //   the passed in storageKey will only have a userId and not a 
        //   conversationId as this is a new conversation.  This will cause use
        //   to load userData but conversationData will be set to {}.
        // * When onSave() is called for a proactive message we don't know the
        //   conversationId yet so we can't actually save anything. The first
        //   call to this.send() results in a conversationId being assigned and
        //   that's the point at which we can actually save state. So we'll update
        //   the storageKey with the new conversationId and then manually trigger
        //   saving the userData & conversationData to storage.
        // * After the first call to onSend() for the conversation everything 
        //   follows the same flow as for reactive messages.
        var loadedData;
        this.getStorageData(storageCtx, function (data) {
            // Create localizer on first access
            if (!_this.localizer) {
                var defaultLocale = _this.settings.localizerSettings ? _this.settings.localizerSettings.defaultLocale : null;
                _this.localizer = new DefaultLocalizer_1.DefaultLocalizer(_this.lib, defaultLocale);
            }
            // Initialize session
            var session = new ses.Session({
                localizer: _this.localizer,
                autoBatchDelay: _this.settings.autoBatchDelay,
                library: _this.lib,
                actions: _this.actions,
                middleware: _this.mwSession,
                dialogId: dialogId,
                dialogArgs: dialogArgs,
                dialogErrorMessage: _this.settings.dialogErrorMessage,
                onSave: function (cb) {
                    var finish = _this.errorLogger(cb);
                    loadedData.userData = utils.clone(session.userData);
                    loadedData.conversationData = utils.clone(session.conversationData);
                    loadedData.privateConversationData = utils.clone(session.privateConversationData);
                    loadedData.privateConversationData[consts.Data.SessionState] = session.sessionState;
                    _this.saveStorageData(storageCtx, loadedData, finish, finish);
                },
                onSend: function (messages, cb) {
                    _this.send(messages, cb);
                }
            });
            session.on('error', function (err) { return _this.emitError(err); });
            // Initialize session data
            var sessionState;
            session.userData = data.userData || {};
            session.conversationData = data.conversationData || {};
            session.privateConversationData = data.privateConversationData || {};
            if (session.privateConversationData.hasOwnProperty(consts.Data.SessionState)) {
                sessionState = newStack ? null : session.privateConversationData[consts.Data.SessionState];
                delete session.privateConversationData[consts.Data.SessionState];
            }
            loadedData = data; // We'll clone it when saving data later
            // Dispatch message
            _this.emit('routing', session);
            session.dispatch(sessionState, message);
            done(null);
        }, done);
    };
    UniversalBot.prototype.eventMiddleware = function (event, middleware, done, error) {
        var i = -1;
        var _this = this;
        function next() {
            if (++i < middleware.length) {
                _this.tryCatch(function () {
                    middleware[i](event, next);
                }, function () { return next(); });
            }
            else {
                _this.tryCatch(function () { return done(); }, error);
            }
        }
        next();
    };
    UniversalBot.prototype.isMessage = function (message) {
        return (message && message.type && message.type.toLowerCase() == consts.messageType);
    };
    UniversalBot.prototype.ensureConversation = function (address, done, error) {
        var _this = this;
        this.tryCatch(function () {
            if (!address.conversation) {
                var connector = _this.connector(address.channelId);
                if (!connector) {
                    throw new Error("Invalid channelId='" + address.channelId + "'");
                }
                connector.startConversation(address, function (err, adr) {
                    if (!err) {
                        _this.tryCatch(function () { return done(adr); }, error);
                    }
                    else if (error) {
                        error(err);
                    }
                });
            }
            else {
                _this.tryCatch(function () { return done(address); }, error);
            }
        }, error);
    };
    UniversalBot.prototype.lookupUser = function (address, done, error) {
        var _this = this;
        this.tryCatch(function () {
            _this.emit('lookupUser', address);
            if (_this.settings.lookupUser) {
                _this.settings.lookupUser(address, function (err, user) {
                    if (!err) {
                        _this.tryCatch(function () { return done(user || address.user); }, error);
                    }
                    else if (error) {
                        error(err);
                    }
                });
            }
            else {
                _this.tryCatch(function () { return done(address.user); }, error);
            }
        }, error);
    };
    UniversalBot.prototype.getStorageData = function (storageCtx, done, error) {
        var _this = this;
        this.tryCatch(function () {
            _this.emit('getStorageData', storageCtx);
            var storage = _this.getStorage();
            storage.getData(storageCtx, function (err, data) {
                if (!err) {
                    _this.tryCatch(function () { return done(data || {}); }, error);
                }
                else if (error) {
                    error(err);
                }
            });
        }, error);
    };
    UniversalBot.prototype.saveStorageData = function (storageCtx, data, done, error) {
        var _this = this;
        this.tryCatch(function () {
            _this.emit('saveStorageData', storageCtx);
            var storage = _this.getStorage();
            storage.saveData(storageCtx, data, function (err) {
                if (!err) {
                    if (done) {
                        _this.tryCatch(function () { return done(); }, error);
                    }
                }
                else if (error) {
                    error(err);
                }
            });
        }, error);
    };
    UniversalBot.prototype.getStorage = function () {
        if (!this.settings.storage) {
            this.settings.storage = new bs.MemoryBotStorage();
        }
        return this.settings.storage;
    };
    UniversalBot.prototype.tryCatch = function (fn, error) {
        try {
            fn();
        }
        catch (e) {
            try {
                if (error) {
                    error(e);
                }
            }
            catch (e2) {
                this.emitError(e2);
            }
        }
    };
    UniversalBot.prototype.errorLogger = function (done) {
        var _this = this;
        return function (err) {
            if (err) {
                _this.emitError(err);
            }
            if (done) {
                done(err);
                done = null;
            }
        };
    };
    UniversalBot.prototype.emitError = function (err) {
        var m = err.toString();
        var e = err instanceof Error ? err : new Error(m);
        if (this.listenerCount('error') > 0) {
            this.emit('error', e);
        }
        else {
            console.error(e.stack);
        }
    };
    return UniversalBot;
}(events.EventEmitter));
exports.UniversalBot = UniversalBot;

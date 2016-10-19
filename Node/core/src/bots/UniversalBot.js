"use strict";
const dl = require('./Library');
const actions = require('../dialogs/ActionSet');
const ses = require('../Session');
const bs = require('../storage/BotStorage');
const consts = require('../consts');
const utils = require('../utils');
const async = require('async');
const events = require('events');
const DefaultLocalizer_1 = require('../DefaultLocalizer');
class UniversalBot extends events.EventEmitter {
    constructor(connector, settings) {
        super();
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
    set(name, value) {
        this.settings[name] = value;
        if (value && name === 'localizerSettings') {
            var settings = value;
            if (settings.botLocalePath) {
                this.lib.localePath(settings.botLocalePath);
            }
        }
        return this;
    }
    get(name) {
        return this.settings[name];
    }
    connector(channelId, connector) {
        var c;
        if (connector) {
            this.connectors[channelId || consts.defaultConnector] = c = connector;
            c.onEvent((events, cb) => this.receive(events, cb));
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
    }
    dialog(id, dialog) {
        return this.lib.dialog(id, dialog);
    }
    library(lib) {
        return this.lib.library(lib);
    }
    use(...args) {
        args.forEach((mw) => {
            var added = 0;
            if (mw.receive) {
                Array.prototype.push.apply(this.mwReceive, Array.isArray(mw.receive) ? mw.receive : [mw.receive]);
                added++;
            }
            if (mw.send) {
                Array.prototype.push.apply(this.mwSend, Array.isArray(mw.send) ? mw.send : [mw.send]);
                added++;
            }
            if (mw.botbuilder) {
                Array.prototype.push.apply(this.mwSession, Array.isArray(mw.botbuilder) ? mw.botbuilder : [mw.botbuilder]);
                added++;
            }
            if (added < 1) {
                console.warn('UniversalBot.use: no compatible middleware hook found to install.');
            }
        });
        return this;
    }
    beginDialogAction(name, id, options) {
        this.actions.beginDialogAction(name, id, options);
        return this;
    }
    endConversationAction(name, msg, options) {
        this.actions.endConversationAction(name, msg, options);
        return this;
    }
    receive(events, done) {
        var list = Array.isArray(events) ? events : [events];
        async.eachLimit(list, this.settings.processLimit, (message, cb) => {
            message.agent = consts.agent;
            message.type = message.type || consts.messageType;
            this.lookupUser(message.address, (user) => {
                if (user) {
                    message.user = user;
                }
                this.emit('receive', message);
                this.eventMiddleware(message, this.mwReceive, () => {
                    if (this.isMessage(message)) {
                        this.emit('incoming', message);
                        var userId = message.user.id;
                        var conversationId = message.address.conversation ? message.address.conversation.id : null;
                        var storageCtx = {
                            userId: userId,
                            conversationId: conversationId,
                            address: message.address,
                            persistUserData: this.settings.persistUserData,
                            persistConversationData: this.settings.persistConversationData
                        };
                        this.route(storageCtx, message, this.settings.defaultDialogId || '/', this.settings.defaultDialogArgs, cb);
                    }
                    else {
                        this.emit(message.type, message);
                        cb(null);
                    }
                }, cb);
            }, cb);
        }, this.errorLogger(done));
    }
    beginDialog(address, dialogId, dialogArgs, done) {
        this.lookupUser(address, (user) => {
            var msg = {
                type: consts.messageType,
                agent: consts.agent,
                source: address.channelId,
                sourceEvent: {},
                address: utils.clone(address),
                text: '',
                user: user
            };
            this.ensureConversation(msg.address, (adr) => {
                msg.address = adr;
                var conversationId = msg.address.conversation ? msg.address.conversation.id : null;
                var storageCtx = {
                    userId: msg.user.id,
                    conversationId: conversationId,
                    address: msg.address,
                    persistUserData: this.settings.persistUserData,
                    persistConversationData: this.settings.persistConversationData
                };
                this.route(storageCtx, msg, dialogId, dialogArgs, this.errorLogger(done), true);
            }, this.errorLogger(done));
        }, this.errorLogger(done));
    }
    send(messages, done) {
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
        async.eachLimit(list, this.settings.processLimit, (message, cb) => {
            this.ensureConversation(message.address, (adr) => {
                message.address = adr;
                this.emit('send', message);
                this.eventMiddleware(message, this.mwSend, () => {
                    this.emit('outgoing', message);
                    cb(null);
                }, cb);
            }, cb);
        }, this.errorLogger((err) => {
            if (!err) {
                this.tryCatch(() => {
                    var channelId = list[0].address.channelId;
                    var connector = this.connector(channelId);
                    if (!connector) {
                        throw new Error("Invalid channelId='" + channelId + "'");
                    }
                    connector.send(list, this.errorLogger(done));
                }, this.errorLogger(done));
            }
            else if (done) {
                done(null);
            }
        }));
    }
    isInConversation(address, cb) {
        this.lookupUser(address, (user) => {
            var conversationId = address.conversation ? address.conversation.id : null;
            var storageCtx = {
                userId: user.id,
                conversationId: conversationId,
                address: address,
                persistUserData: false,
                persistConversationData: false
            };
            this.getStorageData(storageCtx, (data) => {
                var lastAccess;
                if (data && data.privateConversationData && data.privateConversationData.hasOwnProperty(consts.Data.SessionState)) {
                    var ss = data.privateConversationData[consts.Data.SessionState];
                    if (ss && ss.lastAccess) {
                        lastAccess = new Date(ss.lastAccess);
                    }
                }
                cb(null, lastAccess);
            }, this.errorLogger(cb));
        }, this.errorLogger(cb));
    }
    route(storageCtx, message, dialogId, dialogArgs, done, newStack = false) {
        var loadedData;
        this.getStorageData(storageCtx, (data) => {
            if (!this.localizer) {
                var defaultLocale = this.settings.localizerSettings ? this.settings.localizerSettings.defaultLocale : null;
                this.localizer = new DefaultLocalizer_1.DefaultLocalizer(this.lib, defaultLocale);
            }
            var session = new ses.Session({
                localizer: this.localizer,
                autoBatchDelay: this.settings.autoBatchDelay,
                library: this.lib,
                actions: this.actions,
                middleware: this.mwSession,
                dialogId: dialogId,
                dialogArgs: dialogArgs,
                dialogErrorMessage: this.settings.dialogErrorMessage,
                onSave: (cb) => {
                    var finish = this.errorLogger(cb);
                    loadedData.userData = utils.clone(session.userData);
                    loadedData.conversationData = utils.clone(session.conversationData);
                    loadedData.privateConversationData = utils.clone(session.privateConversationData);
                    loadedData.privateConversationData[consts.Data.SessionState] = session.sessionState;
                    this.saveStorageData(storageCtx, loadedData, finish, finish);
                },
                onSend: (messages, cb) => {
                    this.send(messages, cb);
                }
            });
            session.on('error', (err) => this.emitError(err));
            var sessionState;
            session.userData = data.userData || {};
            session.conversationData = data.conversationData || {};
            session.privateConversationData = data.privateConversationData || {};
            if (session.privateConversationData.hasOwnProperty(consts.Data.SessionState)) {
                sessionState = newStack ? null : session.privateConversationData[consts.Data.SessionState];
                delete session.privateConversationData[consts.Data.SessionState];
            }
            loadedData = data;
            this.emit('routing', session);
            session.dispatch(sessionState, message);
            done(null);
        }, done);
    }
    eventMiddleware(event, middleware, done, error) {
        var i = -1;
        var _this = this;
        function next() {
            if (++i < middleware.length) {
                _this.tryCatch(() => {
                    middleware[i](event, next);
                }, () => next());
            }
            else {
                _this.tryCatch(() => done(), error);
            }
        }
        next();
    }
    isMessage(message) {
        return (message && message.type && message.type.toLowerCase() == consts.messageType);
    }
    ensureConversation(address, done, error) {
        this.tryCatch(() => {
            if (!address.conversation) {
                var connector = this.connector(address.channelId);
                if (!connector) {
                    throw new Error("Invalid channelId='" + address.channelId + "'");
                }
                connector.startConversation(address, (err, adr) => {
                    if (!err) {
                        this.tryCatch(() => done(adr), error);
                    }
                    else if (error) {
                        error(err);
                    }
                });
            }
            else {
                this.tryCatch(() => done(address), error);
            }
        }, error);
    }
    lookupUser(address, done, error) {
        this.tryCatch(() => {
            this.emit('lookupUser', address);
            if (this.settings.lookupUser) {
                this.settings.lookupUser(address, (err, user) => {
                    if (!err) {
                        this.tryCatch(() => done(user || address.user), error);
                    }
                    else if (error) {
                        error(err);
                    }
                });
            }
            else {
                this.tryCatch(() => done(address.user), error);
            }
        }, error);
    }
    getStorageData(storageCtx, done, error) {
        this.tryCatch(() => {
            this.emit('getStorageData', storageCtx);
            var storage = this.getStorage();
            storage.getData(storageCtx, (err, data) => {
                if (!err) {
                    this.tryCatch(() => done(data || {}), error);
                }
                else if (error) {
                    error(err);
                }
            });
        }, error);
    }
    saveStorageData(storageCtx, data, done, error) {
        this.tryCatch(() => {
            this.emit('saveStorageData', storageCtx);
            var storage = this.getStorage();
            storage.saveData(storageCtx, data, (err) => {
                if (!err) {
                    if (done) {
                        this.tryCatch(() => done(), error);
                    }
                }
                else if (error) {
                    error(err);
                }
            });
        }, error);
    }
    getStorage() {
        if (!this.settings.storage) {
            this.settings.storage = new bs.MemoryBotStorage();
        }
        return this.settings.storage;
    }
    tryCatch(fn, error) {
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
    }
    errorLogger(done) {
        return (err) => {
            if (err) {
                this.emitError(err);
            }
            if (done) {
                done(err);
                done = null;
            }
        };
    }
    emitError(err) {
        var m = err.toString();
        var e = err instanceof Error ? err : new Error(m);
        if (this.listenerCount('error') > 0) {
            this.emit('error', e);
        }
        else {
            console.error(e.stack);
        }
    }
}
exports.UniversalBot = UniversalBot;
//# sourceMappingURL=UniversalBot.js.map
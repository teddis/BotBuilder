"use strict";
const dl = require('./Library');
const ses = require('../CallSession');
const bs = require('../storage/BotStorage');
const consts = require('../consts');
const utils = require('../utils');
const events = require('events');
class UniversalCallBot extends events.EventEmitter {
    constructor(connector, settings) {
        super();
        this.connector = connector;
        this.settings = {
            processLimit: 4,
            persistUserData: true,
            persistConversationData: false
        };
        this.lib = new dl.Library(consts.Library.default);
        this.mwReceive = [];
        this.mwSend = [];
        this.mwSession = [];
        if (settings) {
            for (var name in settings) {
                this.set(name, settings[name]);
            }
        }
        var asStorage = connector;
        if (!this.settings.storage &&
            typeof asStorage.getData === 'function' &&
            typeof asStorage.saveData === 'function') {
            this.settings.storage = asStorage;
        }
        this.lib.library(dl.systemLib);
        this.connector.onEvent((event, cb) => this.receive(event, cb));
    }
    set(name, value) {
        this.settings[name] = value;
        return this;
    }
    get(name) {
        return this.settings[name];
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
    receive(event, done) {
        var logger = this.errorLogger(done);
        this.lookupUser(event.address, (user) => {
            if (user) {
                event.user = user;
            }
            this.emit('receive', event);
            this.eventMiddleware(event, this.mwReceive, () => {
                this.emit('incoming', event);
                var userId = event.user.id;
                var storageCtx = {
                    userId: userId,
                    conversationId: event.address.conversation.id,
                    address: event.address,
                    persistUserData: this.settings.persistUserData,
                    persistConversationData: this.settings.persistConversationData
                };
                this.route(storageCtx, event, this.settings.defaultDialogId || '/', this.settings.defaultDialogArgs, logger);
            }, logger);
        }, logger);
    }
    send(event, done) {
        var logger = this.errorLogger(done);
        var evt = event.toEvent ? event.toEvent() : event;
        this.emit('send', evt);
        this.eventMiddleware(evt, this.mwSend, () => {
            this.emit('outgoing', evt);
            this.connector.send(evt, logger);
        }, logger);
    }
    route(storageCtx, event, dialogId, dialogArgs, done) {
        var loadedData;
        this.getStorageData(storageCtx, (data) => {
            var session = new ses.CallSession({
                localizer: this.settings.localizer,
                autoBatchDelay: this.settings.autoBatchDelay,
                library: this.lib,
                middleware: this.mwSession,
                dialogId: dialogId,
                dialogArgs: dialogArgs,
                dialogErrorMessage: this.settings.dialogErrorMessage,
                promptDefaults: this.settings.promptDefaults || {},
                recognizeDefaults: this.settings.recognizeDefaults || {},
                recordDefaults: this.settings.recordDefaults || {},
                onSave: (cb) => {
                    var finish = this.errorLogger(cb);
                    loadedData.userData = utils.clone(session.userData);
                    loadedData.conversationData = utils.clone(session.conversationData);
                    loadedData.privateConversationData = utils.clone(session.privateConversationData);
                    loadedData.privateConversationData[consts.Data.SessionState] = session.sessionState;
                    this.saveStorageData(storageCtx, loadedData, finish, finish);
                },
                onSend: (workflow, cb) => {
                    this.send(workflow, cb);
                }
            });
            session.on('error', (err) => this.emitError(err));
            var sessionState;
            session.userData = data.userData || {};
            session.conversationData = data.conversationData || {};
            session.privateConversationData = data.privateConversationData || {};
            if (session.privateConversationData.hasOwnProperty(consts.Data.SessionState)) {
                sessionState = session.privateConversationData[consts.Data.SessionState];
                delete session.privateConversationData[consts.Data.SessionState];
            }
            loadedData = data;
            this.emit('routing', session);
            session.dispatch(sessionState, event);
            done(null);
        }, done);
    }
    eventMiddleware(event, middleware, done, error) {
        var i = -1;
        var _that = this;
        function next() {
            if (++i < middleware.length) {
                _that.tryCatch(() => {
                    middleware[i](event, next);
                }, () => next());
            }
            else {
                _that.tryCatch(() => done(), error);
            }
        }
        next();
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
                this.emitError;
            }
            if (done) {
                done(err);
                done = null;
            }
        };
    }
    emitError(err) {
        var msg = err.toString();
        this.emit("error", err instanceof Error ? err : new Error(msg));
    }
}
exports.UniversalCallBot = UniversalCallBot;
//# sourceMappingURL=UniversalCallBot.js.map
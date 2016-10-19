"use strict";
const dlg = require('./dialogs/Dialog');
const consts = require('./consts');
const sprintf = require('sprintf-js');
const events = require('events');
const msg = require('./Message');
const logger = require('./logger');
const async = require('async');
class Session extends events.EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.msgSent = false;
        this._isReset = false;
        this.lastSendTime = new Date().getTime();
        this.batch = [];
        this.batchStarted = false;
        this.sendingBatch = false;
        this.inMiddleware = false;
        this._locale = null;
        this.localizer = null;
        this.library = options.library;
        this.localizer = options.localizer;
        if (typeof this.options.autoBatchDelay !== 'number') {
            this.options.autoBatchDelay = 250;
        }
    }
    dispatch(sessionState, message) {
        var index = 0;
        var session = this;
        var now = new Date().getTime();
        var middleware = this.options.middleware || [];
        var next = () => {
            var handler = index < middleware.length ? middleware[index] : null;
            if (handler) {
                index++;
                handler(session, next);
            }
            else {
                this.inMiddleware = false;
                this.sessionState.lastAccess = now;
                this.routeMessage();
            }
        };
        this.sessionState = sessionState || { callstack: [], lastAccess: now, version: 0.0 };
        var cur = this.curDialog();
        if (cur) {
            this.dialogData = cur.state;
        }
        this.inMiddleware = true;
        this.message = (message || { text: '' });
        if (!this.message.type) {
            this.message.type = consts.messageType;
        }
        var locale = this.preferredLocale();
        this.localizer.load(locale, (err) => {
            if (err) {
                this.error(err);
            }
            else {
                next();
            }
        });
        return this;
    }
    error(err) {
        logger.info(this, 'session.error()');
        if (this.options.dialogErrorMessage) {
            this.endConversation(this.options.dialogErrorMessage);
        }
        else {
            var locale = this.preferredLocale();
            this.endConversation(this.localizer.gettext(locale, 'default_error', consts.Library.system));
        }
        var m = err.toString();
        err = err instanceof Error ? err : new Error(m);
        this.emit('error', err);
        return this;
    }
    preferredLocale(locale, callback) {
        if (locale) {
            this._locale = locale;
            if (this.userData) {
                this.userData[consts.Data.PreferredLocale] = locale;
            }
            if (this.localizer) {
                this.localizer.load(locale, callback);
            }
        }
        else if (!this._locale) {
            if (this.userData && this.userData[consts.Data.PreferredLocale]) {
                this._locale = this.userData[consts.Data.PreferredLocale];
            }
            else if (this.message && this.message.textLocale) {
                this._locale = this.message.textLocale;
            }
            else if (this.localizer) {
                this._locale = this.localizer.defaultLocale();
            }
        }
        return this._locale;
    }
    gettext(messageid, ...args) {
        return this.vgettext(messageid, args);
    }
    ngettext(messageid, messageid_plural, count) {
        var tmpl;
        if (this.localizer && this.message) {
            tmpl = this.localizer.ngettext(this.message.textLocale || '', messageid, messageid_plural, count);
        }
        else if (count == 1) {
            tmpl = messageid;
        }
        else {
            tmpl = messageid_plural;
        }
        return sprintf.sprintf(tmpl, count);
    }
    save() {
        logger.info(this, 'session.save()');
        this.startBatch();
        return this;
    }
    send(message, ...args) {
        this.msgSent = true;
        if (message) {
            var m;
            if (typeof message == 'string' || Array.isArray(message)) {
                m = this.createMessage(message, args);
            }
            else if (message.toMessage) {
                m = message.toMessage();
            }
            else {
                m = message;
            }
            this.prepareMessage(m);
            this.batch.push(m);
            logger.info(this, 'session.send()');
        }
        this.startBatch();
        return this;
    }
    sendTyping() {
        this.msgSent = true;
        var m = { type: 'typing' };
        this.prepareMessage(m);
        this.batch.push(m);
        logger.info(this, 'session.sendTyping()');
        this.sendBatch();
        return this;
    }
    messageSent() {
        return this.msgSent;
    }
    beginDialog(id, args) {
        logger.info(this, 'session.beginDialog(%s)', id);
        var id = this.resolveDialogId(id);
        var dialog = this.findDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        this.pushDialog({ id: id, state: {} });
        this.startBatch();
        dialog.begin(this, args);
        return this;
    }
    replaceDialog(id, args) {
        logger.info(this, 'session.replaceDialog(%s)', id);
        var id = this.resolveDialogId(id);
        var dialog = this.findDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        this.popDialog();
        this.pushDialog({ id: id, state: {} });
        this.startBatch();
        dialog.begin(this, args);
        return this;
    }
    endConversation(message, ...args) {
        var m;
        if (message) {
            if (typeof message == 'string' || Array.isArray(message)) {
                m = this.createMessage(message, args);
            }
            else if (message.toMessage) {
                m = message.toMessage();
            }
            else {
                m = message;
            }
            this.msgSent = true;
            this.prepareMessage(m);
            this.batch.push(m);
        }
        this.privateConversationData = {};
        logger.info(this, 'session.endConversation()');
        var ss = this.sessionState;
        ss.callstack = [];
        this.sendBatch();
        return this;
    }
    endDialog(message, ...args) {
        if (typeof message === 'object' && (message.hasOwnProperty('response') || message.hasOwnProperty('resumed') || message.hasOwnProperty('error'))) {
            console.warn('Returning results via Session.endDialog() is deprecated. Use Session.endDialogWithResult() instead.');
            return this.endDialogWithResult(message);
        }
        var cur = this.curDialog();
        if (cur) {
            var m;
            if (message) {
                if (typeof message == 'string' || Array.isArray(message)) {
                    m = this.createMessage(message, args);
                }
                else if (message.toMessage) {
                    m = message.toMessage();
                }
                else {
                    m = message;
                }
                this.msgSent = true;
                this.prepareMessage(m);
                this.batch.push(m);
            }
            logger.info(this, 'session.endDialog()');
            var childId = cur.id;
            cur = this.popDialog();
            this.startBatch();
            if (cur) {
                var dialog = this.findDialog(cur.id);
                if (dialog) {
                    dialog.dialogResumed(this, { resumed: dlg.ResumeReason.completed, response: true, childId: childId });
                }
                else {
                    this.error(new Error("Can't resume missing parent dialog '" + cur.id + "'."));
                }
            }
        }
        return this;
    }
    endDialogWithResult(result) {
        var cur = this.curDialog();
        if (cur) {
            result = result || {};
            if (!result.hasOwnProperty('resumed')) {
                result.resumed = dlg.ResumeReason.completed;
            }
            result.childId = cur.id;
            logger.info(this, 'session.endDialogWithResult()');
            cur = this.popDialog();
            this.startBatch();
            if (cur) {
                var dialog = this.findDialog(cur.id);
                if (dialog) {
                    dialog.dialogResumed(this, result);
                }
                else {
                    this.error(new Error("Can't resume missing parent dialog '" + cur.id + "'."));
                }
            }
        }
        return this;
    }
    cancelDialog(dialogId, replaceWithId, replaceWithArgs) {
        var childId = typeof dialogId === 'number' ? this.sessionState.callstack[dialogId].id : dialogId;
        var cur = this.deleteDialogs(dialogId);
        if (replaceWithId) {
            logger.info(this, 'session.cancelDialog(%s)', replaceWithId);
            var id = this.resolveDialogId(replaceWithId);
            var dialog = this.findDialog(id);
            this.pushDialog({ id: id, state: {} });
            this.startBatch();
            dialog.begin(this, replaceWithArgs);
        }
        else {
            logger.info(this, 'session.cancelDialog()');
            this.startBatch();
            if (cur) {
                var dialog = this.findDialog(cur.id);
                if (dialog) {
                    dialog.dialogResumed(this, { resumed: dlg.ResumeReason.canceled, response: null, childId: childId });
                }
                else {
                    this.error(new Error("Can't resume missing parent dialog '" + cur.id + "'."));
                }
            }
        }
        return this;
    }
    reset(dialogId, dialogArgs) {
        logger.info(this, 'session.reset()');
        this._isReset = true;
        this.sessionState.callstack = [];
        if (!dialogId) {
            dialogId = this.options.dialogId;
            dialogArgs = this.options.dialogArgs;
        }
        this.beginDialog(dialogId, dialogArgs);
        return this;
    }
    isReset() {
        return this._isReset;
    }
    sendBatch(callback) {
        logger.info(this, 'session.sendBatch() sending %d messages', this.batch.length);
        if (this.sendingBatch) {
            return;
        }
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.batchTimer = null;
        var batch = this.batch;
        this.batch = [];
        this.batchStarted = false;
        this.sendingBatch = true;
        var cur = this.curDialog();
        if (cur) {
            cur.state = this.dialogData;
        }
        this.options.onSave((err) => {
            if (!err) {
                if (batch.length) {
                    this.options.onSend(batch, (err) => {
                        this.sendingBatch = false;
                        if (this.batchStarted) {
                            this.startBatch();
                        }
                        if (callback) {
                            callback(err);
                        }
                    });
                }
                else {
                    this.sendingBatch = false;
                    if (this.batchStarted) {
                        this.startBatch();
                    }
                    if (callback) {
                        callback(err);
                    }
                }
            }
            else {
                this.sendingBatch = false;
                switch (err.code || '') {
                    case consts.Errors.EBADMSG:
                    case consts.Errors.EMSGSIZE:
                        this.userData = {};
                        this.batch = [];
                        this.endConversation(this.options.dialogErrorMessage || 'Oops. Something went wrong and we need to start over.');
                        break;
                }
                if (callback) {
                    callback(err);
                }
            }
        });
    }
    startBatch() {
        this.batchStarted = true;
        if (!this.sendingBatch) {
            if (this.batchTimer) {
                clearTimeout(this.batchTimer);
            }
            this.batchTimer = setTimeout(() => {
                this.sendBatch();
            }, this.options.autoBatchDelay);
        }
    }
    createMessage(text, args) {
        args.unshift(text);
        var message = new msg.Message(this);
        msg.Message.prototype.text.apply(message, args);
        return message.toMessage();
    }
    prepareMessage(msg) {
        if (!msg.type) {
            msg.type = 'message';
        }
        if (!msg.address) {
            msg.address = this.message.address;
        }
        if (!msg.textLocale && this.message.textLocale) {
            msg.textLocale = this.message.textLocale;
        }
    }
    routeMessage() {
        var _that = this;
        function routeToDialog(recognizeResult) {
            var cur = _that.curDialog();
            if (!cur) {
                _that.beginDialog(_that.options.dialogId, _that.options.dialogArgs);
            }
            else {
                var dialog = _that.findDialog(cur.id);
                _that.dialogData = cur.state;
                dialog.replyReceived(_that, recognizeResult);
            }
        }
        if (this.validateCallstack()) {
            this.recognizeCurDialog((err, dialogResult) => {
                if (err) {
                    this.error(err);
                }
                else if (dialogResult.score < 1.0) {
                    this.recognizeCallstackActions((err, actionResult) => {
                        if (err) {
                            this.error(err);
                        }
                        else if (actionResult.score > dialogResult.score) {
                            if (actionResult.dialogId) {
                                var dialog = this.findDialog(actionResult.dialogId);
                                dialog.invokeAction(this, actionResult);
                            }
                            else {
                                this.options.actions.invokeAction(this, actionResult);
                            }
                        }
                        else {
                            routeToDialog(dialogResult);
                        }
                    });
                }
                else {
                    routeToDialog(dialogResult);
                }
            });
        }
        else {
            logger.warn(this, 'Callstack is invalid, resetting session.');
            this.reset(this.options.dialogId, this.options.dialogArgs);
        }
    }
    recognizeCurDialog(done) {
        var cur = this.curDialog();
        if (cur && this.message.text.indexOf('action?') !== 0) {
            var dialog = this.findDialog(cur.id);
            var locale = this.preferredLocale();
            dialog.recognize({ message: this.message, locale: locale, dialogData: cur.state, activeDialog: true }, done);
        }
        else {
            done(null, { score: 0.0 });
        }
    }
    recognizeCallstackActions(done) {
        var ss = this.sessionState;
        var i = ss.callstack.length - 1;
        var result = { score: 0.0 };
        async.whilst(() => {
            return (i >= 0 && result.score < 1.0);
        }, (cb) => {
            try {
                var index = i--;
                var cur = ss.callstack[index];
                var dialog = this.findDialog(cur.id);
                dialog.recognizeAction(this.message, (err, r) => {
                    if (!err && r && r.score > result.score) {
                        result = r;
                        result.dialogId = cur.id;
                        result.dialogIndex = index;
                    }
                    cb(err);
                });
            }
            catch (e) {
                cb(e);
            }
        }, (err) => {
            if (!err) {
                if (result.score < 1.0 && this.options.actions) {
                    this.options.actions.recognizeAction(this.message, (err, r) => {
                        if (!err && r && r.score > result.score) {
                            result = r;
                        }
                        done(err, result);
                    });
                }
                else {
                    done(null, result);
                }
            }
            else {
                done(err instanceof Error ? err : new Error(err.toString()), null);
            }
        });
    }
    vgettext(messageid, args) {
        var tmpl;
        if (this.localizer && this.message) {
            tmpl = this.localizer.gettext(this.preferredLocale() || this.message.textLocale || '', messageid);
        }
        else {
            tmpl = messageid;
        }
        return args && args.length > 0 ? sprintf.vsprintf(tmpl, args) : tmpl;
    }
    validateCallstack() {
        var ss = this.sessionState;
        for (var i = 0; i < ss.callstack.length; i++) {
            var id = ss.callstack[i].id;
            if (!this.findDialog(id)) {
                return false;
            }
        }
        return true;
    }
    resolveDialogId(id) {
        if (id.indexOf(':') >= 0) {
            return id;
        }
        var cur = this.curDialog();
        var libName = cur && !this.inMiddleware ? cur.id.split(':')[0] : consts.Library.default;
        return libName + ':' + id;
    }
    findDialog(id) {
        var parts = id.split(':');
        return this.library.findDialog(parts[0] || consts.Library.default, parts[1]);
    }
    pushDialog(ds) {
        var ss = this.sessionState;
        var cur = this.curDialog();
        if (cur) {
            cur.state = this.dialogData || {};
        }
        ss.callstack.push(ds);
        this.dialogData = ds.state || {};
        return ds;
    }
    popDialog() {
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            ss.callstack.pop();
        }
        var cur = this.curDialog();
        this.dialogData = cur ? cur.state : null;
        return cur;
    }
    deleteDialogs(dialogId) {
        var ss = this.sessionState;
        var index = -1;
        if (typeof dialogId === 'string') {
            for (var i = ss.callstack.length - 1; i >= 0; i--) {
                if (ss.callstack[i].id == dialogId) {
                    index = i;
                    break;
                }
            }
        }
        else {
            index = dialogId;
        }
        if (index < 0 && index < ss.callstack.length) {
            throw new Error('Unable to cancel dialog. Dialog[' + dialogId + '] not found.');
        }
        ss.callstack.splice(index);
        var cur = this.curDialog();
        this.dialogData = cur ? cur.state : null;
        return cur;
    }
    curDialog() {
        var cur;
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            cur = ss.callstack[ss.callstack.length - 1];
        }
        return cur;
    }
    getMessageReceived() {
        console.warn("Session.getMessageReceived() is deprecated. Use Session.message.sourceEvent instead.");
        return this.message.sourceEvent;
    }
}
exports.Session = Session;
//# sourceMappingURL=Session.js.map
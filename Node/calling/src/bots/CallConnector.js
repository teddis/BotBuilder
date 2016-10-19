"use strict";
const request = require('request');
const async = require('async');
const url = require('url');
const utils = require('../utils');
const consts = require('../consts');
var Busboy = require('busboy');
var jwt = require('jsonwebtoken');
var getPem = require('rsa-pem-from-mod-exp');
var base64url = require('base64url');
var keysLastFetched = 0;
var cachedKeys;
var issuer;
class CallConnector {
    constructor(settings) {
        this.settings = settings;
        this.responses = {};
        if (!this.settings.endpoint) {
            this.settings.endpoint = {
                refreshEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                refreshScope: 'https://graph.microsoft.com/.default',
                verifyEndpoint: 'https://api.aps.skype.com/v1/.well-known/openidconfiguration',
                verifyIssuer: 'https://api.botframework.com',
                stateEndpoint: this.settings.stateUrl || 'https://state.botframework.com'
            };
        }
    }
    listen() {
        return (req, res) => {
            var correlationId = req.headers['X-Microsoft-Skype-Chain-ID'];
            if (req.is('application/json')) {
                this.parseBody(req, (err, body) => {
                    if (!err) {
                        body.correlationId = correlationId;
                        req.body = body;
                        this.verifyBotFramework(req, res);
                    }
                    else {
                        res.status(400);
                        res.end();
                    }
                });
            }
            else if (req.is('multipart/form-data')) {
                this.parseFormData(req, (err, body) => {
                    if (!err) {
                        body.correlationId = correlationId;
                        req.body = body;
                        this.verifyBotFramework(req, res);
                    }
                    else {
                        res.status(400);
                        res.end();
                    }
                });
            }
            else {
                res.status(400);
                res.end();
            }
        };
    }
    ensureCachedKeys(cb) {
        var now = new Date().getTime();
        if (keysLastFetched < (now - 1000 * 60 * 60 * 24)) {
            var options = {
                method: 'GET',
                url: this.settings.endpoint.verifyEndpoint,
                json: true
            };
            request(options, (err, response, body) => {
                if (!err && (response.statusCode >= 400 || !body)) {
                    err = new Error("Failed to load openID config: " + response.statusCode);
                }
                if (err) {
                    cb(err, null);
                }
                else {
                    var openIdConfig = body;
                    issuer = openIdConfig.issuer;
                    var options = {
                        method: 'GET',
                        url: openIdConfig.jwks_uri,
                        json: true
                    };
                    request(options, (err, response, body) => {
                        if (!err && (response.statusCode >= 400 || !body)) {
                            err = new Error("Failed to load Keys: " + response.statusCode);
                        }
                        if (!err) {
                            keysLastFetched = now;
                        }
                        cachedKeys = body.keys;
                        cb(err, cachedKeys);
                    });
                }
            });
        }
        else {
            cb(null, cachedKeys);
        }
    }
    getSecretForKey(keyId) {
        for (var i = 0; i < cachedKeys.length; i++) {
            if (cachedKeys[i].kid == keyId) {
                var jwt = cachedKeys[i];
                var modulus = base64url.toBase64(jwt.n);
                var exponent = jwt.e;
                return getPem(modulus, exponent);
            }
        }
        return null;
    }
    verifyBotFramework(req, res) {
        var token;
        if (req.headers && req.headers.hasOwnProperty('authorization')) {
            var auth = req.headers['authorization'].trim().split(' ');
            ;
            if (auth.length == 2 && auth[0].toLowerCase() == 'bearer') {
                token = auth[1];
            }
        }
        var callback = this.responseCallback(req, res);
        if (token) {
            this.ensureCachedKeys((err, keys) => {
                if (!err) {
                    var decoded = jwt.decode(token, { complete: true });
                    var now = new Date().getTime() / 1000;
                    if (decoded.payload.aud != this.settings.appId || decoded.payload.iss != issuer ||
                        now > decoded.payload.exp || now < decoded.payload.nbf) {
                        res.status(403);
                        res.end();
                    }
                    else {
                        var keyId = decoded.header.kid;
                        var secret = this.getSecretForKey(keyId);
                        try {
                            decoded = jwt.verify(token, secret);
                            this.dispatch(req.body, callback);
                        }
                        catch (err) {
                            res.status(403);
                            res.end();
                        }
                    }
                }
                else {
                    res.status(500);
                    res.end();
                }
            });
        }
        else {
            res.status(401);
            res.end();
        }
    }
    onEvent(handler) {
        this.handler = handler;
    }
    send(event, cb) {
        if (event.type == 'workflow' && event.address && event.address.conversation) {
            var conversation = event.address.conversation;
            if (this.responses.hasOwnProperty(conversation.id)) {
                var callback = this.responses[conversation.id];
                delete this.responses[conversation.id];
                var response = utils.clone(event);
                response.links = { 'callback': this.settings.callbackUrl };
                response.appState = JSON.stringify(response.address);
                delete response.type;
                delete response.address;
                callback(null, response);
            }
        }
        else {
            cb(new Error('Invalid message sent to CallConnector.send().'));
        }
    }
    getData(context, callback) {
        try {
            var root = this.getStoragePath();
            var list = [];
            if (context.userId) {
                if (context.persistUserData) {
                    list.push({
                        field: 'userData',
                        url: root + '/users/' + encodeURIComponent(context.userId)
                    });
                }
                if (context.conversationId) {
                    list.push({
                        field: 'privateConversationData',
                        url: root + '/conversations/' + encodeURIComponent(context.conversationId) +
                            '/users/' + encodeURIComponent(context.userId)
                    });
                }
            }
            if (context.persistConversationData && context.conversationId) {
                list.push({
                    field: 'conversationData',
                    url: root + '/conversations/' + encodeURIComponent(context.conversationId)
                });
            }
            var data = {};
            async.each(list, (entry, cb) => {
                var options = {
                    method: 'GET',
                    url: entry.url,
                    json: true
                };
                this.authenticatedRequest(options, (err, response, body) => {
                    if (!err && body) {
                        try {
                            var botData = body.data ? body.data : {};
                            data[entry.field + 'Hash'] = JSON.stringify(botData);
                            data[entry.field] = botData;
                        }
                        catch (e) {
                            err = e;
                        }
                    }
                    cb(err);
                });
            }, (err) => {
                if (!err) {
                    callback(null, data);
                }
                else {
                    var msg = err.toString();
                    callback(err instanceof Error ? err : new Error(msg), null);
                }
            });
        }
        catch (e) {
            callback(e instanceof Error ? e : new Error(e.toString()), null);
        }
    }
    saveData(context, data, callback) {
        var list = [];
        function addWrite(field, botData, url) {
            var hashKey = field + 'Hash';
            var hash = JSON.stringify(botData);
            if (!data[hashKey] || hash !== data[hashKey]) {
                data[hashKey] = hash;
                list.push({ botData: botData, url: url });
            }
        }
        try {
            var root = this.getStoragePath();
            if (context.userId) {
                if (context.persistUserData) {
                    addWrite('userData', data.userData || {}, root + '/users/' + encodeURIComponent(context.userId));
                }
                if (context.conversationId) {
                    var url = root + '/conversations/' + encodeURIComponent(context.conversationId) +
                        '/users/' + encodeURIComponent(context.userId);
                    addWrite('privateConversationData', data.privateConversationData || {}, url);
                }
            }
            if (context.persistConversationData && context.conversationId) {
                addWrite('conversationData', data.conversationData || {}, root + '/conversations/' + encodeURIComponent(context.conversationId));
            }
            async.each(list, (entry, cb) => {
                var options = {
                    method: 'POST',
                    url: entry.url,
                    body: { eTag: '*', data: entry.botData },
                    json: true
                };
                this.authenticatedRequest(options, (err, response, body) => {
                    cb(err);
                });
            }, (err) => {
                if (callback) {
                    if (!err) {
                        callback(null);
                    }
                    else {
                        var msg = err.toString();
                        callback(err instanceof Error ? err : new Error(msg));
                    }
                }
            });
        }
        catch (e) {
            if (callback) {
                callback(e instanceof Error ? e : new Error(e.toString()));
            }
        }
    }
    dispatch(body, response) {
        if (body.callState == 'terminated') {
            return response(null);
        }
        var event = {};
        event.agent = consts.agent;
        event.source = 'skype';
        event.sourceEvent = body;
        this.responses[body.id] = response;
        if (body.hasOwnProperty('participants')) {
            var convo = body;
            event.type = 'conversation';
            utils.copyFieldsTo(convo, event, 'callState|links|presentedModalityTypes');
            var address = event.address = {};
            address.useAuth = true;
            address.channelId = event.source;
            address.correlationId = convo.correlationId;
            address.serviceUrl = this.settings.serviceUrl || 'https://skype.botframework.com';
            address.conversation = { id: convo.id, isGroup: convo.isMultiparty };
            utils.copyFieldsTo(convo, address, 'threadId|subject');
            if (address.subject) {
                address.conversation.name = address.subject;
            }
            address.participants = [];
            convo.participants.forEach((p) => {
                var identity = {
                    id: p.identity,
                    name: p.displayName,
                    locale: p.languageId,
                    originator: p.originator
                };
                address.participants.push(identity);
                if (identity.originator) {
                    address.user = identity;
                }
                else if (identity.id.indexOf('28:') == 0) {
                    address.bot = identity;
                }
            });
        }
        else {
            var result = body;
            event.type = 'conversationResult';
            event.address = JSON.parse(result.appState);
            utils.copyFieldsTo(result, event, 'links|operationOutcome|recordedAudio');
            if (result.id !== event.address.conversation.id) {
                console.warn("CallConnector received a 'conversationResult' with an invalid conversation id.");
            }
        }
        this.handler(event, (err) => {
            if (err && this.responses.hasOwnProperty(body.id)) {
                delete this.responses[body.id];
                response(err);
            }
        });
    }
    authenticatedRequest(options, callback, refresh = false) {
        if (refresh) {
            this.accessToken = null;
        }
        this.addAccessToken(options, (err) => {
            if (!err) {
                request(options, (err, response, body) => {
                    if (!err) {
                        switch (response.statusCode) {
                            case 401:
                            case 403:
                                if (!refresh) {
                                    this.authenticatedRequest(options, callback, true);
                                }
                                else {
                                    callback(null, response, body);
                                }
                                break;
                            default:
                                if (response.statusCode < 400) {
                                    callback(null, response, body);
                                }
                                else {
                                    var txt = "Request to '" + options.url + "' failed: [" + response.statusCode + "] " + response.statusMessage;
                                    callback(new Error(txt), response, null);
                                }
                                break;
                        }
                    }
                    else {
                        callback(err, null, null);
                    }
                });
            }
            else {
                callback(err, null, null);
            }
        });
    }
    getAccessToken(cb) {
        if (!this.accessToken || new Date().getTime() >= this.accessTokenExpires) {
            var opt = {
                method: 'POST',
                url: this.settings.endpoint.refreshEndpoint,
                form: {
                    grant_type: 'client_credentials',
                    client_id: this.settings.appId,
                    client_secret: this.settings.appPassword,
                    scope: this.settings.endpoint.refreshScope
                }
            };
            request(opt, (err, response, body) => {
                if (!err) {
                    if (body && response.statusCode < 300) {
                        var oauthResponse = JSON.parse(body);
                        this.accessToken = oauthResponse.access_token;
                        this.accessTokenExpires = new Date().getTime() + ((oauthResponse.expires_in - 300) * 1000);
                        cb(null, this.accessToken);
                    }
                    else {
                        cb(new Error('Refresh access token failed with status code: ' + response.statusCode), null);
                    }
                }
                else {
                    cb(err, null);
                }
            });
        }
        else {
            cb(null, this.accessToken);
        }
    }
    addAccessToken(options, cb) {
        if (this.settings.appId && this.settings.appPassword) {
            this.getAccessToken((err, token) => {
                if (!err && token) {
                    options.headers = {
                        'Authorization': 'Bearer ' + token
                    };
                    cb(null);
                }
                else {
                    cb(err);
                }
            });
        }
        else {
            cb(null);
        }
    }
    getStoragePath() {
        return url.resolve(this.settings.endpoint.stateEndpoint, '/v3/botstate/skype/');
    }
    parseBody(req, cb) {
        if (typeof req.body === 'undefined') {
            var data = '';
            req.on('data', (chunk) => data += chunk);
            req.on('end', () => {
                var err;
                var body;
                try {
                    body = JSON.parse(data);
                }
                catch (e) {
                    err = e;
                }
                cb(err, body);
            });
        }
        else {
            cb(null, req.body);
        }
    }
    parseFormData(req, cb) {
        var busboy = new Busboy({ headers: req.headers, defCharset: 'binary' });
        var result;
        var recordedAudio;
        busboy.on('field', (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) => {
            if (fieldname === 'recordedAudio') {
                recordedAudio = new Buffer(val, 'binary');
            }
            else if (fieldname === 'conversationResult') {
                result = JSON.parse(val);
            }
        });
        busboy.on('finish', () => {
            if (result && recordedAudio) {
                result.recordedAudio = recordedAudio;
            }
            cb(null, result);
        });
        req.pipe(busboy);
    }
    responseCallback(req, res) {
        return function (err, response) {
            if (err) {
                res.status(500);
                res.end();
            }
            else {
                res.status(200);
                res.send(response);
            }
        };
    }
}
exports.CallConnector = CallConnector;
//# sourceMappingURL=CallConnector.js.map
"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApexWebSocket = void 0;
var webSocket_1 = require("rxjs/webSocket");
var WebSocket = require("ws");
var utils_1 = require("./utils");
var ApexWebSocket = /** @class */ (function () {
    function ApexWebSocket(options) {
        this.client = {};
        this.createTimes = 0;
        this.seq = 0;
        this.callback = {};
        this.isLogin = false;
        this.options = __assign({ prettyPrint: false, delayBeforeRetryConnectMs: 500 }, options);
        this.debugMode = !!options.debugMode;
    }
    ApexWebSocket.prototype.createClient = function () {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!(this.seq > 0)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.delay(this.options.delayBeforeRetryConnectMs)];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        if (this.debugMode) {
                            this.createTimes++;
                            (0, utils_1.log)("AP: Create connection: ".concat(this.createTimes, "} times"), this.createTimes);
                        }
                        if (!(!this.ws || ((_a = this.ws) === null || _a === void 0 ? void 0 : _a.closed))) return [3 /*break*/, 6];
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, 5, , 6]);
                        this.seq = 0;
                        this.isLogin = false;
                        this.ws = (0, webSocket_1.webSocket)({
                            url: this.options.url,
                            openObserver: {
                                next: this.options.onOpen
                                    ? this.options.onOpen
                                    : function () {
                                        var username = _this.options.credentials.username;
                                        (0, utils_1.log)("AP ".concat(username, ": Connection established"));
                                    },
                            },
                            // retry create new connection
                            closeObserver: {
                                next: this.options.onClose
                                    ? this.options.onClose
                                    : function () { return __awaiter(_this, void 0, void 0, function () {
                                        return __generator(this, function (_a) {
                                            (0, utils_1.log)('AP: Received Close Event');
                                            this.close();
                                            this.createClient();
                                            return [2 /*return*/];
                                        });
                                    }); },
                            },
                            serializer: function (value) {
                                return _this.serializer(value);
                            },
                            deserializer: function (e) {
                                return _this.deserializer(e.data);
                            },
                            WebSocketCtor: WebSocket.WebSocket,
                        });
                        this.ws.subscribe({
                            next: function (data) {
                                if (data.m === 3 /* MessageFrameType.EVENT */ &&
                                    data.n === 'LogoutEvent') {
                                    _this.close();
                                    _this.createClient();
                                }
                                else if (_this.callback[data.i]) {
                                    if (data.o === 'Endpoint Not Found') {
                                        _this.login();
                                    }
                                    try {
                                        _this.callback[data.i](data);
                                    }
                                    finally {
                                        delete _this.callback[data.i];
                                    }
                                }
                            },
                            error: function (err) {
                                console.error(err);
                            },
                            complete: function () {
                                (0, utils_1.log)('AP: Websocket connection is closed');
                            },
                        });
                        return [4 /*yield*/, this.login()];
                    case 4:
                        _b.sent();
                        this.addEndpoints(this.options.endpoints);
                        return [3 /*break*/, 6];
                    case 5:
                        error_1 = _b.sent();
                        console.error(error_1);
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    ApexWebSocket.prototype.login = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, username, password, result;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.isLogin) return [3 /*break*/, 2];
                        (0, utils_1.log)('AP: Still have pending login request. Restart connection for new session token');
                        this.close();
                        return [4 /*yield*/, this.createClient()];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        this.isLogin = true;
                        (0, utils_1.log)('AP: Pending Login');
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, , 5, 6]);
                        _a = this.options.credentials, username = _a.username, password = _a.password;
                        return [4 /*yield*/, this.authenticateUser(username, password)];
                    case 4:
                        result = _b.sent();
                        (0, utils_1.log)("AP ".concat(username, ": AuthenticateUser"), {
                            authenticate: result.Authenticated,
                            sessionToken: result.SessionToken,
                        });
                        return [3 /*break*/, 6];
                    case 5:
                        this.isLogin = false;
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    ApexWebSocket.prototype.close = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (this.ws) {
                    this.ws.complete();
                    this.ws = undefined;
                }
                return [2 /*return*/];
            });
        });
    };
    ApexWebSocket.prototype.delay = function (time) {
        if (time === void 0) { time = 500; }
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(time >= 0)) return [3 /*break*/, 2];
                        return [4 /*yield*/, (0, utils_1.sleep)(time)];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    ApexWebSocket.prototype.serializer = function (value) {
        for (var key in value) {
            if (typeof value[key] === 'object' &&
                !Array.isArray(value[key]) &&
                value[key] !== null) {
                value[key] = this.serializer(value[key]);
            }
        }
        return JSON.stringify(value);
    };
    ApexWebSocket.prototype.deserializer = function (value) {
        var _this = this;
        try {
            return JSON.parse(value, function (_, val) {
                if (typeof val === 'string')
                    return _this.deserializer(val);
                return val;
            });
        }
        catch (exc) {
            return value;
        }
    };
    ApexWebSocket.prototype.prettyJSONStringify = function (data) {
        if (typeof data === 'string')
            return data;
        if ('password' in data) {
            delete data.password;
        }
        var space = this.options.prettyPrint ? 2 : 0;
        return JSON.stringify(data, null, space);
    };
    ApexWebSocket.prototype.RPCCall = function (functionName, data, callback) {
        var _a;
        if (!this.ws) {
            throw new Error('AP: Websocket is not connected');
        }
        var messageFrame = {
            m: 0 /* MessageFrameType.REQUEST */,
            i: this.seq,
            n: functionName,
            o: data,
        };
        if (this.debugMode) {
            (0, utils_1.log)("AP: ".concat(functionName, " (").concat(this.seq, "): ").concat(this.prettyJSONStringify(data)), data);
        }
        this.callback[this.seq] = callback;
        this.seq += 2;
        (_a = this.ws) === null || _a === void 0 ? void 0 : _a.next(messageFrame);
    };
    ApexWebSocket.prototype.RPCPromise = function (functionName, params) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.RPCCall(functionName, params, function (data) {
                if (data.m === 5 /* MessageFrameType.ERROR */) {
                    reject(new Error("AP ".concat(functionName, " error message: ").concat(_this.prettyJSONStringify(data.o))));
                }
                else {
                    resolve(data.o);
                }
            });
        });
    };
    ApexWebSocket.prototype.buildEndpoint = function (functionName) {
        var _this = this;
        return function (params) {
            return new Promise(function (resolve, reject) {
                _this.RPCCall(functionName, params, function (data) {
                    if (data.m === 5 /* MessageFrameType.ERROR */) {
                        reject(new Error("AP ".concat(functionName, " error message: ").concat(_this.prettyJSONStringify(data.o))));
                    }
                    resolve(data.o);
                });
            });
        };
    };
    ApexWebSocket.prototype.addEndpoints = function (endpoints) {
        var _this = this;
        if (endpoints.length > 0) {
            endpoints.forEach(function (endpoint) {
                _this.client[endpoint] = _this.buildEndpoint(endpoint);
            });
        }
    };
    ApexWebSocket.prototype.authenticateUser = function (username, password) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.RPCPromise('AuthenticateUser', { username: username, password: password })];
            });
        });
    };
    ApexWebSocket.prototype.getClient = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.createClient()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, this.client];
                }
            });
        });
    };
    return ApexWebSocket;
}());
exports.ApexWebSocket = ApexWebSocket;

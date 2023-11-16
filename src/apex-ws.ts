import { WebSocketSubject, webSocket } from 'rxjs/webSocket'
import * as WebSocket from 'ws'
import {
    ApexWebSocketOptions,
    MessageFrame,
    MessageFrameType,
} from './apex-ws.interface'
import { log, sleep } from './utils'

export class ApexWebSocket {
    private options: ApexWebSocketOptions
    ws: WebSocketSubject<MessageFrame> | undefined
    client: any = {}
    createTimes = 0
    private seq = 0
    private callback = {}
    private debugMode: boolean
    private isLogin = false

    constructor(options: ApexWebSocketOptions) {
        this.options = {
            prettyPrint: false,
            delayBeforeRetryConnectMs: 500,
            ...options,
        }
        this.debugMode = !!options.debugMode
    }

    async createClient() {
        if (this.seq > 0) {
            await this.delay(this.options.delayBeforeRetryConnectMs)
        }
        if (this.debugMode) {
            this.createTimes++
            log(
                `AP: Create connection: ${this.createTimes}} times`,
                this.createTimes,
            )
        }
        if (!this.ws || this.ws?.closed) {
            try {
                this.seq = 0
                this.isLogin = false
                this.ws = webSocket({
                    url: this.options.url,
                    openObserver: {
                        next: this.options.onOpen
                            ? this.options.onOpen
                            : () => {
                                  const { username } = this.options.credentials
                                  log(`AP ${username}: Connection established`)
                              },
                    },
                    // retry create new connection
                    closeObserver: {
                        next: this.options.onClose
                            ? this.options.onClose
                            : async () => {
                                  log('AP: Received Close Event')
                                  this.close()
                                  this.createClient()
                              },
                    },
                    serializer: (value: MessageFrame) => {
                        return this.serializer(value)
                    },
                    deserializer: (e: MessageEvent) => {
                        return this.deserializer(e.data)
                    },
                    WebSocketCtor: (WebSocket as any).WebSocket,
                })
                this.ws.subscribe({
                    next: (data: MessageFrame) => {
                        if (
                            data.m === MessageFrameType.EVENT &&
                            data.n === 'LogoutEvent'
                        ) {
                            this.close()
                            this.createClient()
                        } else if (this.callback[data.i]) {
                            if (data.o === 'Endpoint Not Found') {
                                this.login()
                            }
                            try {
                                this.callback[data.i](data)
                            } finally {
                                delete this.callback[data.i]
                            }
                        }
                    },
                    error: (err) => {
                        console.error(err)
                    },
                    complete: () => {
                        log('AP: Websocket connection is closed')
                    },
                })
                await this.login()
                this.addEndpoints(this.options.endpoints)
            } catch (error) {
                console.error(error)
            }
        }
    }

    async login() {
        if (this.isLogin) {
            log(
                'AP: Still have pending login request. Restart connection for new session token',
            )
            this.close()
            await this.createClient()
        }
        this.isLogin = true
        log('AP: Pending Login')
        try {
            const { username, password } = this.options.credentials
            const result = await this.authenticateUser(username, password)
            log(`AP ${username}: AuthenticateUser`, {
                authenticate: result.Authenticated,
                sessionToken: result.SessionToken,
            })
        } finally {
            this.isLogin = false
        }
    }

    async close() {
        if (this.ws) {
            this.ws.complete()
            this.ws = undefined
        }
    }

    async delay(time = 500) {
        if (time >= 0) {
            await sleep(time)
        }
    }

    serializer(value: object): any {
        for (const key in value) {
            if (
                typeof value[key] === 'object' &&
                !Array.isArray(value[key]) &&
                value[key] !== null
            ) {
                value[key] = this.serializer(value[key])
            }
        }
        return JSON.stringify(value)
    }

    deserializer(value: string): any {
        try {
            return JSON.parse(value, (_, val) => {
                if (typeof val === 'string') return this.deserializer(val)
                return val
            })
        } catch (exc) {
            return value
        }
    }

    prettyJSONStringify(data: Record<string, any> | string) {
        if (typeof data === 'string') return data
        if ('password' in data) {
            delete data.password
        }
        const space = this.options.prettyPrint ? 2 : 0
        return JSON.stringify(data, null, space)
    }

    RPCCall(
        functionName: string,
        data: Record<string, any>,
        callback: Function,
    ): void {
        if (!this.ws) {
            throw new Error('AP: Websocket is not connected')
        }
        const messageFrame: MessageFrame = {
            m: MessageFrameType.REQUEST,
            i: this.seq,
            n: functionName,
            o: data,
        }
        if (this.debugMode) {
            log(
                `AP: ${functionName} (${this.seq}): ${this.prettyJSONStringify(
                    data,
                )}`,
                data,
            )
        }
        this.callback[this.seq] = callback
        this.seq += 2
        this.ws?.next(messageFrame)
    }

    RPCPromise(
        functionName: string,
        params: Record<string, any>,
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            this.RPCCall(functionName, params, (data: MessageFrame) => {
                if (data.m === MessageFrameType.ERROR) {
                    reject(
                        new Error(
                            `AP ${functionName} error message: ${this.prettyJSONStringify(
                                data.o,
                            )}`,
                        ),
                    )
                } else {
                    resolve(data.o)
                }
            })
        })
    }

    buildEndpoint(
        functionName: string,
    ): (params: Record<string, any>) => Promise<any> {
        return (params: Record<string, any>) =>
            new Promise((resolve, reject) => {
                this.RPCCall(functionName, params, (data: MessageFrame) => {
                    if (data.m === MessageFrameType.ERROR) {
                        reject(
                            new Error(
                                `AP ${functionName} error message: ${this.prettyJSONStringify(
                                    data.o,
                                )}`,
                            ),
                        )
                    }
                    resolve(data.o)
                })
            })
    }

    addEndpoints(endpoints: readonly string[]) {
        if (endpoints.length > 0) {
            endpoints.forEach((endpoint) => {
                this.client[endpoint] = this.buildEndpoint(endpoint)
            })
        }
    }

    async authenticateUser(
        username: string,
        password: string,
    ): Promise<{
        Authenticated: boolean
        SessionToken: string
    }> {
        return this.RPCPromise('AuthenticateUser', { username, password })
    }

    async getClient() {
        await this.createClient()
        return this.client
    }
}

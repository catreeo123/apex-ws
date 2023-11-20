import { WebSocketSubject, webSocket } from 'rxjs/webSocket'
import * as WebSocket from 'ws'
import {
    ApexWebSocketOptions,
    MessageFrame,
    MessageFrameType,
} from './apex-ws.interface'
import { customError, customLog, sleep } from './utils'

export class ApexWebSocket {
    private options: ApexWebSocketOptions
    ws: WebSocketSubject<MessageFrame> | undefined
    client: any = {}
    createTimes = 0
    private seq = 0
    private callback = {}
    private debugMode: boolean
    private isLogin = false
    private endpoints = [] as readonly string[]

    constructor(options: ApexWebSocketOptions) {
        this.options = {
            prettyPrint: false,
            delayBeforeRetryConnectMs: 500,
            ...options,
        }
        this.debugMode = !!options.debugMode
    }

    async createClient() {
        // if seq > 0, means we are retrying to connect
        // so we need to delay before create new connection
        // to avoid multiple connections at the same time
        // and to avoid multiple login requests
        if (this.seq > 0) {
            await this.delay(this.options.delayBeforeRetryConnectMs)
        }
        if (this.debugMode) {
            this.createTimes++
            customLog(
                `AP: Create connection: ${this.createTimes}} times`,
                this.createTimes,
            )
        }
        // create websocket connection if not exist
        if (!this.ws || this.ws?.closed) {
            customLog('AP: Creating connection')
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
                                  customLog(
                                      `AP ${username}: Connection established`,
                                  )
                              },
                    },
                    closingObserver: {
                        next: () => {
                            customLog(
                                'AP: Received complete event by close function',
                            )
                        },
                    },
                    // retry to create new connection when received close event
                    closeObserver: {
                        next: this.options.onClose
                            ? this.options.onClose
                            : async () => {
                                  customLog('AP: Received close event')
                                  this.close()
                                  this.createClient()
                              },
                    },
                    // use custom serializer for nest object
                    serializer: (value: MessageFrame) => {
                        return this.serializer(value)
                    },
                    // same as serializer for nest object string
                    deserializer: (e: MessageEvent) => {
                        return this.deserializer(e.data)
                    },
                    WebSocketCtor: (WebSocket as any).WebSocket,
                })
                this.ws.subscribe({
                    next: (data: MessageFrame) => {
                        // if received logout event create the new connection for new session token
                        if (
                            data.m === MessageFrameType.EVENT &&
                            data.n === 'LogoutEvent'
                        ) {
                            this.close()
                            this.createClient()
                        }
                        // try to re-login if endpoint not found because of unauthorize
                        else if (data.o === 'Endpoint Not Found') {
                            customLog(
                                `AP: ${data.n} (${data.i}): ${data.o}.Try to re-login`,
                            )
                            this.login()
                        }
                        // return the result to caller function
                        else if (this.callback[data.i]) {
                            try {
                                this.callback[data.i](data)
                            } catch (error) {
                                customError(error)
                                return undefined
                            } finally {
                                delete this.callback[data.i]
                            }
                        }
                    },
                    error: (error) => {
                        customError(error)
                    },
                    complete: () => {
                        customLog('AP: Websocket connection is closed')
                    },
                })
                await this.login()
                if (this.endpoints) {
                    this.addEndpoints(this.endpoints)
                }
            } catch (error) {
                customError(error)
            }
        }
    }

    async login() {
        if (this.isLogin) {
            customLog(
                `AP: A Login Skipped. There is still a pending login request.`,
            )
            return
        }
        this.isLogin = true
        customLog('AP: Pending Login')
        try {
            const { username, password } = this.options.credentials
            // prevent login to stuck and skip forever
            const loginTimeout = setTimeout(() => {
                this.isLogin = false
                customError('AP: Login Timeout, set isLogin to false')
            }, 5000)
            const result = await this.authenticateUser(username, password)
            clearTimeout(loginTimeout)
            customLog(`AP ${username}: AuthenticateUser`, {
                authenticate: result.Authenticated,
                sessionToken: result.SessionToken,
            })
        } catch (error) {
            customError(error)
        } finally {
            this.isLogin = false
        }
    }

    async close() {
        if (this.ws) {
            customLog('AP: Connection is closing')
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
            customLog(
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
                if (data.m !== MessageFrameType.REPLY) {
                    reject(
                        new Error(
                            `AP ${functionName} ${
                                data.i
                            } error message: ${this.prettyJSONStringify(
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
            this.RPCPromise(functionName, params)
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

    async getClient<const T extends string[]>(
        endpoints: readonly [...T],
    ): Promise<Record<T[number], (params: any) => Promise<any>>> {
        await this.createClient()
        this.endpoints = endpoints
        this.addEndpoints(endpoints)
        return this.client
    }
}

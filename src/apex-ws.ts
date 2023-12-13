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
    private client: any = {}
    private createTimes = 0
    private seq = 0
    private callback = {}
    private timeout = {}
    private debugMode = false
    private isLogin = false
    private isExit = false
    private endpoints = [] as readonly string[]

    constructor(options: ApexWebSocketOptions) {
        this.options = {
            prettyPrint: false,
            delayBeforeRetryConnect: 500,
            requestTimeout: 10000,
            ...options,
        }
        this.debugMode = !!options.debugMode
    }

    private async createClient() {
        // if seq > 0, means we are retrying to connect
        // so we need to delay before create new connection
        // to avoid multiple connections at the same time
        // and to avoid multiple login requests
        if (this.seq > 0) {
            await this.delay(this.options.delayBeforeRetryConnect)
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
                this.ws = this.createWebSocket()
                this.ws.subscribe(this.handleWebSocketReply())
                await this.login()
                if (this.endpoints) {
                    this.addEndpoints(this.endpoints)
                }
            } catch (error) {
                customError(error)
            }
        }
    }

    private handleWebSocketReply() {
        return {
            next: (data: MessageFrame) => {
                // if received logout event create the new connection for new session token
                if (
                    data.m === MessageFrameType.EVENT &&
                    data.n === 'LogoutEvent'
                ) {
                    customLog(`AP: ${data.n} (${data.i}): ${data.o}.`)
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
                    this.callback[data.i](data)
                    clearTimeout(this.timeout[data.i])
                    delete this.timeout[data.i]
                    delete this.callback[data.i]
                }
            },
            error: (error) => {
                customError(error)
            },
            complete: () => {
                customLog('AP: Websocket connection is closed')
            },
        }
    }

    private createWebSocket(): WebSocketSubject<MessageFrame> {
        return webSocket({
            url: this.options.url,
            openObserver: {
                next: this.options.onOpen
                    ? this.options.onOpen
                    : () => {
                          const { username } = this.options.credentials
                          customLog(`AP ${username}: Connection established`)
                      },
            },
            closingObserver: {
                next: () => {
                    customLog('AP: Received complete event by close function')
                },
            },
            // retry to create new connection when received close event
            closeObserver: {
                next: this.options.onClose
                    ? this.options.onClose
                    : async () => {
                          customLog('AP: Received close event')
                          this.close()
                          if (!this.isExit) {
                              this.createClient()
                          }
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
    }

    private async login() {
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
                if (this.isLogin) {
                    this.isLogin = false
                    customError('AP: Login Timeout, set isLogin to false')
                }
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

    /**
     * Use for close connection before retry to connect again
     */
    close() {
        if (this.ws) {
            customLog('AP: Connection is closing')
            this.ws.complete()
            this.ws = undefined
        }
    }

    /**
     * Use when exit app to close connection and not retry
     */
    exit() {
        this.isExit = true
        this.close()
    }

    private async delay(time = 500) {
        if (time >= 0) {
            await sleep(time)
        }
    }

    private serializer(value: object): any {
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

    private deserializer(value: string): any {
        try {
            return JSON.parse(value, (_, val) => {
                if (typeof val === 'string') return this.deserializer(val)
                return val
            })
        } catch (exc) {
            return value
        }
    }

    private prettyJSONStringify(data: Record<string, any> | string) {
        if (typeof data === 'string') return data
        if ('password' in data) {
            delete data.password
        }
        const space = this.options.prettyPrint ? 2 : 0
        return JSON.stringify(data, null, space)
    }

    private RPCCall(
        functionName: string,
        data: Record<string, any>,
        callback: (data: MessageFrame) => void,
    ): void {
        if (!this.ws) {
            throw new Error('AP: Websocket is not connected')
        }
        const seq = this.seq
        const messageFrame: MessageFrame = {
            m: MessageFrameType.REQUEST,
            i: seq,
            n: functionName,
            o: data,
        }
        if (this.debugMode) {
            customLog(
                `AP: ${functionName} (${seq}): ${this.prettyJSONStringify(
                    data,
                )}`,
                data,
            )
        }
        this.callback[seq] = callback
        this.timeout[seq] = setTimeout(
            () => {
                if (this.callback[seq]) {
                    this.callback[seq]({
                        m: MessageFrameType.ERROR,
                        i: seq,
                        o: 'Request Time out',
                    })
                    delete this.callback[seq]
                }
            },
            functionName === 'AuthenticateUser'
                ? 5000
                : this.options.requestTimeout,
        )
        this.seq += 2
        this.ws?.next(messageFrame)
    }

    private RPCPromise(
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

    private buildEndpoint(
        functionName: string,
    ): (params: Record<string, any>) => Promise<any> {
        return (params: Record<string, any>) =>
            this.RPCPromise(functionName, params)
    }

    private addEndpoints(endpoints: readonly string[]) {
        if (endpoints.length > 0) {
            endpoints.forEach((endpoint) => {
                this.client[endpoint] = this.buildEndpoint(endpoint)
            })
        }
    }

    private async authenticateUser(
        username: string,
        password: string,
    ): Promise<{
        Authenticated: boolean
        SessionToken: string
    }> {
        return this.RPCPromise('AuthenticateUser', { username, password })
    }
    /**
     * For create client and build endpoint from input endpoints for using in the future
     */
    async getClient<const T extends string[]>(
        endpoints: readonly [...T],
    ): Promise<Record<T[number], (params: any) => Promise<any>>> {
        await this.createClient()
        this.endpoints = endpoints
        this.addEndpoints(endpoints)
        return this.client
    }
}

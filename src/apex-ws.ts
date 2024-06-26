import CircuitBreaker = require('opossum')
import { catchError, config, of } from 'rxjs'
import { WebSocketSubject, webSocket } from 'rxjs/webSocket'
import * as WebSocket from 'ws'
import {
    ApexWebSocketOptions,
    EndpointOptions,
    MessageFrame,
    MessageFrameType,
} from './apex-ws.interface'
import {
    convertErrorToJSON,
    customDebug,
    customError,
    customLog,
    sleep,
} from './utils'

export class ApexWebSocket {
    private options: ApexWebSocketOptions
    ws: WebSocketSubject<MessageFrame> | undefined
    private client: any = {}
    private seq = 0
    private callback = {}
    private timeout = {}
    private debugMode = false
    private isLogin = false
    private isLoggingIn = false
    private isExit = false
    private endpoints = [] as readonly string[]
    private retryAttempts = 0

    private keepAliveInterval: NodeJS.Timeout = null

    private logger: ApexWebSocketOptions['logger'] = {
        log: customLog,
        error: customError,
        debug: customDebug,
    }

    constructor(options: ApexWebSocketOptions) {
        this.options = {
            prettyPrint: false,
            delayBeforeRetryConnect: 1000,
            delayTypeBeforeRetryConnect: 'fixed',
            maxDelayTimeBeforeRetryConnect: 30000,
            requestTimeout: 10000,
            ...options,
            ping: {
                interval: 300000,
                failedDelay: 30000,
                retryTimes: 5,
                ...options.ping,
            },
        }
        this.debugMode = !!options.debugMode
        if (options.logger) {
            this.logger = options.logger
        }
        config.onUnhandledError = (err) => {
            this.logger.error({
                message: 'unhandled error of rxjs',
                error: {
                    message: err.message,
                    stack: err.stack,
                    kind: err.name,
                },
            })
        }
    }

    private async createClient() {
        try {
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval)
                this.keepAliveInterval = null
            }
            // create websocket connection if not exist
            if (!this.ws || this.ws?.closed) {
                this.logger.log({ message: 'AP: Creating connection' })
                this.seq = 0
                this.isLogin = false
                this.isLoggingIn = false
                this.ws = this.createWebSocket()
                this.ws
                    .pipe(
                        catchError((err) => {
                            this.logger.error({
                                message: 'ws pipe error',
                                error: {
                                    message: err.message,
                                    stack: err.stack,
                                    kind: err.name,
                                },
                            })
                            return of('Error')
                        }),
                    )
                    .subscribe(this.handleWebSocketReply())
                await this.login()
                if (this.endpoints) {
                    this.addEndpoints(this.endpoints)
                }
                this.keepAliveInterval = this.keepAlive()
            }
        } catch (err) {
            this.logger.error({
                message: 'AP: createClient error',
                error: {
                    message: err.message,
                    stack: err.stack,
                    kind: err.name,
                },
            })
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
                    this.logger.log({
                        message: `AP: ${data.n} (${data.i}): Logout event`,
                        metadata: {
                            data,
                        },
                    })
                    this.close()
                }
                // try to re-login if endpoint not found because of unauthorize
                else if (data.o === 'Endpoint Not Found') {
                    this.logger.log({
                        message: `AP: ${data.n} (${data.i}): ${data.o}.Try to re-login`,
                    })
                    this.login()
                } else if (data.m === MessageFrameType.ERROR) {
                    this.logger.log({
                        message: `AP: ${data.n} (${data.i}): Error`,
                        metadata: { data },
                    })
                }
                // return the result to caller function
                else if (
                    data.m === MessageFrameType.REPLY &&
                    this.callback[data.i]
                ) {
                    this.callback[data.i](data)
                    clearTimeout(this.timeout[data.i])
                    delete this.timeout[data.i]
                    delete this.callback[data.i]
                    // reset retry attempts if can success received message
                    if (this.retryAttempts > 0) {
                        this.retryAttempts = 0
                    }
                }
            },
            error: (error) => {
                this.logger.error({
                    message: `AP: handleWebSocketReply error: ${error.message}}`,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        kind: error.name,
                    },
                })
            },
            complete: () => {
                this.logger.log({
                    message: 'AP: Websocket connection is closed',
                })
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
                          this.logger.log({
                              message: `AP ${username}: Connection established`,
                          })
                      },
            },
            closingObserver: {
                next: () => {
                    this.logger.log({
                        message:
                            'AP: Received complete event by close function',
                    })
                },
            },
            // retry to create new connection when received close event
            closeObserver: {
                next: this.options.onClose
                    ? this.options.onClose
                    : async () => {
                          this.logger.log({
                              message: 'AP: Received close event',
                          })
                          this.close()
                          if (!this.isExit) {
                              await this.delayForCreateNewConnection()
                              await this.createClient()
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

    private async delayForCreateNewConnection() {
        let delayTime = this.options.delayBeforeRetryConnect
        this.retryAttempts++
        if (this.options.delayTypeBeforeRetryConnect === 'liner') {
            delayTime = Math.min(
                delayTime * this.retryAttempts,
                this.options.maxDelayTimeBeforeRetryConnect,
            )
        }
        this.logger.log({
            message: `AP: Retry connection: ${this.retryAttempts} times`,
        })
        // To make it not login at the same time and cause loop logout login min 1 sec and max 5 sec
        const randomDelay = Math.floor(Math.random() * 4000) + 1000
        await this.delay(delayTime + randomDelay)
    }

    private async login() {
        if (this.isLoggingIn) {
            this.logger.log({
                message: `AP: A Login Skipped. There is still a pending login request.`,
            })
            return
        }
        this.isLoggingIn = true
        this.logger.log({ message: 'AP: Pending Login' })
        try {
            const { username, password } = this.options.credentials
            // prevent login to stuck and skip forever
            const loginTimeout = setTimeout(() => {
                if (this.isLoggingIn) {
                    this.isLoggingIn = false
                    this.logger.error({
                        message: 'AP: Login Timeout, set isLoggingIn to false',
                    })
                }
            }, 5000)
            const result = await this.authenticateUser(username, password)
            clearTimeout(loginTimeout)
            this.isLogin = result.Authenticated ?? false
            const maskToken =
                result.SessionToken?.slice(0, -12) + '************'
            this.logger.log({
                message: `AP ${username}: AuthenticateUser`,
                metadata: {
                    authenticate: result.Authenticated,
                    sessionToken: maskToken,
                },
            })
        } catch (error) {
            this.logger.error({
                message: `AP: login error: ${error.message}`,
                error: {
                    message: error.message,
                    stack: error.stack,
                    kind: error.name,
                },
            })
        } finally {
            this.isLoggingIn = false
        }
    }

    /**
     * Use for close connection before retry to connect again
     */
    close() {
        if (this.ws) {
            this.logger.log({ message: 'AP: Connection is closing' })
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
            return JSON.parse(value, (key, val) => {
                const regex = /[{[].*[}\]]/g
                if (typeof val === 'string' && regex.test(val)) {
                    return this.deserializer(val)
                }
                return val
            })
        } catch (exc) {
            return value
        }
    }

    private prettyJSONStringify(data: Record<string, any> | string) {
        if (typeof data === 'string') return data
        const space = this.options.prettyPrint ? 2 : 0
        return JSON.stringify(data, null, space)
    }

    private RPCCall(
        functionName: string,
        data: Record<string, any>,
        callback: (data: MessageFrame) => void,
        timeoutMs?: number,
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
        this.callback[seq] = callback
        this.timeout[seq] = setTimeout(
            () => {
                if (this.callback[seq]) {
                    this.callback[seq]({
                        m: MessageFrameType.ERROR,
                        n: functionName,
                        i: seq,
                        o: 'Request Time out',
                    })
                    delete this.callback[seq]
                }
            },
            timeoutMs > 0 ? timeoutMs : this.options.requestTimeout,
        )
        this.seq += 2
        if (!this.isLogin && functionName !== 'AuthenticateUser') {
            this.login().then(() => this.ws?.next(messageFrame))
        } else {
            this.ws?.next(messageFrame)
        }
        if (this.debugMode) {
            const dataToLog = { ...data }
            if ('password' in dataToLog) {
                delete dataToLog.password
            }
            this.logger.debug({
                message: `AP: ${functionName} (${seq}): ${this.prettyJSONStringify(
                    dataToLog,
                )}`,
                metadata: dataToLog,
            })
        }
    }

    private checkResult({ o: data }: Pick<MessageFrame, 'o'>): boolean {
        if (typeof data === 'string') {
            return true
        }
        if ('result' in data) {
            return data.result as boolean
        } else {
            return true
        }
    }

    private async RPCPromise(
        functionName: string,
        params: Record<string, any>,
        timeoutMs?: number,
    ): Promise<any> {
        // if (functionName !== 'AuthenticateUser') {
        //     const start = performance.now()
        //     while (
        //         (!this.ws || !this.isLogin) &&
        //         performance.now() <
        //             start + this.options.maxDelayTimeBeforeRetryConnect
        //     ) {
        //         await sleep(500)
        //     }
        // }
        return new Promise((resolve, reject) => {
            this.RPCCall(
                functionName,
                params,
                (data: MessageFrame) => {
                    this.RPCCallBack(functionName, data, resolve, reject)
                },
                timeoutMs,
            )
        })
    }

    private async RPCCallBack(
        functionName: string,
        data: MessageFrame,
        resolve,
        reject,
    ) {
        if (data.m !== MessageFrameType.REPLY || !this.checkResult(data)) {
            reject(
                new Error(
                    `AP ${functionName} ${
                        data.i
                    } error message: ${this.prettyJSONStringify(data.o)}`,
                ),
            )
        } else {
            resolve(data.o)
        }
    }

    buildEndpoint(
        functionName: string,
        circuitBreakerOptions?: CircuitBreaker.Options,
    ): (
        params: Record<string, any>,
        options?: EndpointOptions,
    ) => Promise<any> {
        const RPCPromiseBreaker = new CircuitBreaker(
            this.RPCPromise.bind(this),
            {
                enabled: false,
                ...this.options.circuitBreaker,
                ...circuitBreakerOptions,
                timeout: false,
            },
        )
        RPCPromiseBreaker.fallback((functionName, params, timeout, error?) => {
            if (error?.message === 'Breaker is open') {
                throw new Error(`${functionName} not available right now`, {
                    cause: error,
                })
            }
            throw error
        })

        const endpoint = async (
            params: Record<string, any>,
            {
                throwError = false,
                maxRetry = 0,
                retryCount = 1,
                timeoutMs,
            }: EndpointOptions & { retryCount?: number } = {},
        ) => {
            const currRetry = typeof retryCount === 'number' ? retryCount : 1
            try {
                return await RPCPromiseBreaker.fire(
                    functionName,
                    params,
                    timeoutMs,
                )
            } catch (error) {
                if (currRetry >= maxRetry) {
                    this.logger.error({
                        message: error.message,
                        error: convertErrorToJSON(error),
                        metadata: { params },
                    })
                    if (throwError) {
                        throw error
                    }
                } else {
                    this.logger.error({
                        message: `AP ${functionName} retry ${currRetry} failed.`,
                        error: convertErrorToJSON(error),
                        metadata: { params },
                    })
                    return endpoint(params, {
                        throwError: throwError,
                        maxRetry: maxRetry,
                        retryCount: retryCount + 1,
                        timeoutMs,
                    })
                }
            }
        }
        return endpoint
    }

    private addEndpoints(endpoints: readonly string[]) {
        if (endpoints.length > 0) {
            endpoints.forEach((endpoint) => {
                this.client[endpoint] = this.buildEndpoint(endpoint)
            })
        }
    }
    private keepAlive() {
        return setInterval(async () => {
            try {
                const pong = await this.ping()
                if (pong?.msg !== 'PONG') {
                    throw new Error('AP Server not response with PONG')
                }
            } catch (error) {
                this.close()
            }
        }, this.options.ping.interval)
    }

    private async authenticateUser(
        username: string,
        password: string,
    ): Promise<{
        Authenticated: boolean
        SessionToken: string
    }> {
        return this.RPCPromise(
            'AuthenticateUser',
            { username, password },
            10000,
        )
    }

    private async ping() {
        return this.retry(
            () => this.RPCPromise('Ping', { omsId: 1 }, 10000),
            this.options.ping.retryTimes,
            this.options.ping.failedDelay,
        )
    }
    /**
     * For create client and build endpoint from input endpoints for using in the future
     */
    async getClient<const T extends string[]>(
        endpoints: readonly [...T],
    ): Promise<
        Record<
            T[number],
            (params: any, options?: EndpointOptions) => Promise<any>
        >
    > {
        await this.createClient()
        this.endpoints = endpoints
        this.addEndpoints(endpoints)
        return this.client
    }

    getPendingRequest() {
        return this.callback
    }

    async retry(cb: () => any, times: number, delay = 0) {
        for (let attempt = 1; attempt <= times; attempt++) {
            try {
                return await cb()
            } catch (error) {
                if (attempt >= times) {
                    this.logger.error({
                        message: error.message,
                        error: convertErrorToJSON(error),
                    })
                    throw error
                }
                this.logger.error({
                    message: `AP retry ${attempt} failed.`,
                    error: convertErrorToJSON(error),
                })

                if (delay > 0) {
                    await sleep(delay)
                }
            }
        }
    }
}

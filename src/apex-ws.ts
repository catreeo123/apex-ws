import * as CircuitBreaker from 'opossum'
import { catchError, config, of } from 'rxjs'
import { WebSocketSubject, webSocket } from 'rxjs/webSocket'
import * as WebSocket from 'ws'
import {
    ApexWebSocketOptions,
    EndpointOptions,
    MessageFrame,
    MessageFrameType,
} from './apex-ws.interface'
import { customDebug, customError, customLog, sleep } from './utils'

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
        }
        this.debugMode = !!options.debugMode
        if (options.logger) {
            this.logger = options.logger
        }
        config.onUnhandledError = (err) => {
            this.logger.error({
                message: 'unhandled error of rxjs',
                error: err,
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
                                error: err,
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
            this.logger.error({ message: 'AP: createClient error', error: err })
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
                    error,
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
                error,
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
            ['AuthenticateUser', 'Ping'].includes(functionName)
                ? 5000
                : this.options.requestTimeout,
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
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            this.RPCCall(functionName, params, (data: MessageFrame) => {
                this.RPCCallBack(functionName, data, resolve, reject)
            })
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

    private buildEndpoint(
        functionName: string,
    ): (
        params: Record<string, any>,
        options?: EndpointOptions,
    ) => Promise<any> {
        const RPCPromiseBreaker = new CircuitBreaker(
            this.RPCPromise.bind(this),
            {
                ...this.options.circuitBreaker,
                timeout: this.options.requestTimeout + 1000,
            },
        )
        RPCPromiseBreaker.fallback((functionName, params, error?) => {
            if (error?.message === 'Breaker is open') {
                throw new Error(`${functionName} not available right now`, {
                    cause: error,
                })
            }
            throw error
        })
        const RPCPromiseCircuitBreaker = async (
            functionName: string,
            params: Record<string, any>,
        ) => {
            return await RPCPromiseBreaker.fire(functionName, params)
        }
        const endpoint = async (
            params: Record<string, any>,
            {
                forceThrowError = false,
                maxRetry = 0,
                retryCount = 1,
            }: EndpointOptions & { retryCount?: number } = {},
        ) => {
            const currRetry = typeof retryCount === 'number' ? retryCount : 1
            try {
                return await RPCPromiseCircuitBreaker(functionName, params)
            } catch (error) {
                this.logger.error({
                    message: `AP ${functionName} retry ${currRetry} failed.`,
                    error,
                    metadata: { params },
                })
                if (currRetry > maxRetry) {
                    this.logger.error({
                        message: error.message,
                        error,
                        metadata: { params },
                    })
                    if (forceThrowError) {
                        throw error
                    }
                } else {
                    return endpoint(params, {
                        forceThrowError: forceThrowError,
                        maxRetry: maxRetry,
                        retryCount: retryCount + 1,
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
        }, 300000)
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

    private async ping() {
        return await this.RPCPromise('Ping', { omsId: 1 })
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
}

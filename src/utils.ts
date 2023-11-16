export const sleep = async (time: number) => {
    return new Promise((resolve) => setTimeout(resolve, time))
}

export const log = (message: string, metadata?: any) => {
    if (metadata) {
        console.log(JSON.stringify({ message, metadata }))
    } else {
        console.log(JSON.stringify({ message }))
    }
}

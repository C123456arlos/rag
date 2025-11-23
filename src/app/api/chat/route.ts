import { Configuration, OpenAIApi } from 'openai-edge'
import { Message, OpenAIStream, StreamingTextResponse } from 'ai'
import { chats, messages as _messages } from '@/lib/db/schema'
import { db } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
export const runtime = 'edge'
const config = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
})
const openai = new OpenAIApi(config)
export async function POST(req: Request) {
    try {
        const { messages, chatId } = await req.json()
        const _chats = await db.select().from(chats).where(eq(chats.id, chatId))
        if (_chats.length != 1) {
            return NextResponse.json({ 'error': 'error not found' }, { status: 404 })
        }
        const lastMessage = messages[messages.length - 1]
        const fileKey = _chats[0].fileKey
        const context = await getContext(lastMessage.content, fileKey)

        const prompt = {
            role: 'system',
            content: `ai assistant is a brand new, powerful, human-like artificial inteligence, the traits of AI include expert knowledge Start Content 
            Block ${context}
            END OF CONTEXT BLOCK
            ai assitant will take into account any context block that is provided in the conversation`
        }
        const response = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: {
                prompt, ...messages.filter((message: Message) => message.role === 'user')
            },
            stream: true
        })
        const stream = OpenAIStream(response, {
            onStart: async () => {
                await db.insert(_messages).values({
                    chatId, content: lastMessage.content,
                    role: 'user'
                })
            },
            onCompletion: async (completion) => {
                await db.insert(_messages).values({
                    chatId,
                    content: completion,
                    role: 'system'
                })
            }
        })
        return new StreamingTextResponse(stream)
    } catch (error) {

    }
}
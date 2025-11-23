import { PineconeClient, Vector, utils as PineconeUtils } from '@pinecone-database/pinecone'
import { downloadFromS3 } from './s3-server'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { Document, RecursiveCharacterTextSplitter } from '@pinecone-database/doc-splitter'
import { getEmbeddings } from './embeddings'
import md5 from 'md5'
import { convertToAscii } from './utils'
let pinecone: PineconeClient | null = null
export const getPineconeClient = async () => {
    if (!pinecone) {
        pinecone = new PineconeClient()
        await pinecone.init({
            environment: process.env.PINECONE_ENVIRONMENT!,
            apiKey: process.env.PINECONE_API_KEY!,
        })
    }
    return pinecone
}
type PDFPage = {
    pageContent: string
    metadata: {
        loc: { pageNumber: number }
    }
}
export async function loadS3IntoPinecone(fileKey: string) {
    console.log('downloading')
    const file_name = await downloadFromS3(fileKey)
    if (!file_name) {
        throw new Error('s3')
    }
    const loader = new PDFLoader(file_name)
    const pages = (await loader.load()) as PDFPage[]
    const documents = await Promise.all(pages.map(prepareDocument))
    const vectors = await Promise.all(documents.flat().map(embedDocument))
    const client = await getPineconeClient()
    const pineconeIndex = client.Index('rag')
    console.log('inserting vectors')
    const namespace = convertToAscii(fileKey)
    PineconeUtils.chunkedUpsert(pineconeIndex, vectors, namespace, 10)
    return documents[0]
}
async function embedDocument(doc: Document) {
    try {
        const embeddings = await getEmbeddings(doc.pageContent)
        const hash = md5(doc.pageContent)
        return {
            id: hash, values: embeddings,
            metadata: {
                text: doc.metadata.text,
                pageNumber: doc.metadata.pageNumber
            }
        }
    } catch (error) {
        console.log('no embedding', error)
        throw error
    }
}
export const truncateStringByBytes = (str: string, bytes: number) => {
    const enc = new TextEncoder()
    return new TextDecoder('utf-8').decode(enc.encode(str).slice(0, bytes))
}
async function prepareDocument(page: PDFPage) {
    let { pageContent, metadata } = page
    pageContent = pageContent.replace(/\n/g, '')
    const splitter = new RecursiveCharacterTextSplitter()
    const docs = await splitter.splitDocuments([
        new Document({
            pageContent,
            metadata: {
                pageNumber: metadata.loc.pageNumber,
                text: truncateStringByBytes(pageContent, 36000)
            }
        })
    ])
    return docs
}
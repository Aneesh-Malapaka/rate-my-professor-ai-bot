//creating the nextjs app chat routes
import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {VertexAI, TextEmbeddingModel} from "@google-cloud/vertexai"

const systemPrompt = `
You are a "Rate My Professor" agent designed to assist students in finding the best classes and professors based on their queries. When a student asks a question, you will:

Analyze the question to identify the relevant subject, course, or professor attributes.
Retrieve and rank the top 3 professors that best match the query.
Provide a response using the information about these top 3 professors, including their ratings, reviews, and relevant course details.

Your goal is to deliver concise, accurate, and helpful answers that guide students in choosing the best professor or class for their needs.

## Your Capabilities:
1.You have access to a comprehensive database of professors, their ratings, reviews, and course details.
2.You use RAG to retrieve relevant information from the database based on the student's query.
3. For each query, you rank the top 3 professors based on their relevance and popularity.

## Your Response Should :
1. Be concise yet informative, focusing on the most relevant information of the top 3 professors.
2. Include the professor's name, rating, reviews, and course details.
3. Highlight any specific aspects mentioned in the student's query (eg: teaching style, course difficulty, grading fairness, etc.)

## Response Format:
For each query, structure your response as follows:

1. A brief introduction mentioning the student's query.
2. The top 3 professors Recommendation:
    - Professor Name (Subject, Domain) - Star Rating
    - Brief Summary of the professor's teaching style, course difficulty, grading fairness, etc.
3. A concise conclusion with any additional advice or sugestions for the student.

## Guidelines:
- Always maintain a professional and helpful tone.
- If the query is too vague or lacks specific details, suggest seeking more information from the student.
- If no professors match the specific query, suggest exploring other closest  matches. and provide an explanation why.
- Be prepared to answer follow-up questions about the specific professors or compare multiple professors.
- Do not fabricate information or make assumptions about the student's query. Always refer to the database for accurate information. If unsure state it back clearly.

`
export async function POST(req){
    const data = await req.json();
    const pc = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    })

    const index = pc.index("rag-rmp").namespace("namespace1")
    const apiKey = process.env.GEMINI_API_KEY;
    
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt,
      });
    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain",
      };

    const text = data[data.length-1].content

    //getting embeddings
    // const embedding = await genai.embed_content({
    //     model: "models/text-embedding-004",
    //     content: text,
    //     task_type: "retrieval_document",
    // });
    
    // VertexAI.initialize({
    //   projectId: process.env.GOOGLE_PROJECT_ID,
    //   location: us-central1,
    // });

    
    async function main(
        project,
        model = 'text-embedding-004',
        texts = text,
        task = 'RETRIEVAL_QUERY',
        dimensionality = 0,
        apiEndpoint = 'us-central1-aiplatform.googleapis.com'
      ) {
        const aiplatform = require('@google-cloud/aiplatform');
        const { PredictionServiceClient } = aiplatform.v1;
        const { helpers } = aiplatform;
        const clientOptions = { apiEndpoint: apiEndpoint };
        const location = 'us-central1';
        const endpoint = `projects/${project}/locations/${location}/publishers/google/models/${model}`;
    
        async function callPredict() {
          const instances = texts.split(';').map((e) =>
            helpers.toValue({
              content: e,
              task_type: task,
            })
          );
          const parameters = helpers.toValue(
            dimensionality > 0
              ? { outputDimensionality: parseInt(dimensionality) }
              : {}
          );
          const request = { endpoint, instances, parameters };
          const client = new PredictionServiceClient(clientOptions);
          const [response] = await client.predict(request);
          const predictions = response.predictions;
          const embeddings = predictions.map((p) => {
            const embeddingsProto = p.structValue.fields.embeddings;
            const valuesProto = embeddingsProto.structValue.fields.values;
            return valuesProto.listValue.values.map((v) => v.numberValue);
          });
          // console.log('Got embeddings: \n' + JSON.stringify(embeddings));
          return embeddings[0];
        }
        return await callPredict();
      }
    const embedding = await main(
        process.env.GOOGLE_PROJECT_ID,
      );
    
      console.log(embedding)
    // console.log("embedding in js part: ", embedding)
    const results = await index.query({
      topK: 3,
      includeMetadata: true,
      vector: embedding,
    })

    //response as string
    let resultString = '\nReturned results from db: '
    results.matches.forEach((match) => {
        resultString += `\n
        Professor Name: ${match.id}
        Subject: ${match.metadata.subject}
        Domain: ${match.metadata.domain}
        Rating: ${match.metadata.rating}
        Reviews: ${match.metadata.review}
        `
    })

    const lastMessageContent = data[data.length-1].content +resultString

    //creating ai chat completion
    const lastDataWithoutMessage = data.slice(0,data.length-1)
    console.log(lastDataWithoutMessage, lastMessageContent)
    const chatSession = model.startChat({
      generationConfig,
      history: [],
    });
  
    const result = await chatSession.sendMessage(lastMessageContent);
    console.log(result.response.text());

    const responseData = {
      text: result.response.text() // Or however you want to structure this
    };
    
    return NextResponse.json(responseData);
}

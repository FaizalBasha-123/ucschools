
import { GoogleGenAI } from "@google/genai";
import { SearchResult, GroundingSource } from "../types";

const API_KEY = process.env.API_KEY || '';

export const findSchools = async (query: string, location?: { latitude: number; longitude: number }): Promise<SearchResult> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const systemInstruction = `You are a helpful educational consultant for myschools. 
  Your goal is to help parents find the best schools. 
  If a location is provided, focus on that area. 
  Always be objective and highlight key features like curriculum, facilities, and reputation.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Find information about: ${query}${location ? ` near ${location.latitude}, ${location.longitude}` : ''}`,
    config: {
      systemInstruction,
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text || "I couldn't find specific information for that query. Try being more specific about the location or school type.";
  
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources: GroundingSource[] = groundingChunks
    .map((chunk: any) => chunk.web)
    .filter((web: any) => web && web.uri)
    .map((web: any) => ({
      title: web.title || "External Resource",
      uri: web.uri,
    }));

  return { text, sources };
};

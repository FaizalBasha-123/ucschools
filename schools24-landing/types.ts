
export interface School {
  name: string;
  rating: number;
  location: string;
  description: string;
  image: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SearchResult {
  text: string;
  sources: GroundingSource[];
}

export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_REQUEST_TIMEOUT_MS = 10_000;
export const GROQ_MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 500, 502, 503, 504]);

export function getGroqModel(configuredModel = process.env.GROQ_MODEL) {
  const model = configuredModel?.trim();
  if (!model) throw new Error('GROQ_MODEL_MISSING');
  return model;
}

function providerError(status: number, body: string) {
  const error = new Error(body || `Groq API returned HTTP ${status}.`);
  Object.assign(error, { status });
  return error;
}

function retryDelay() {
  return new Promise(resolve => setTimeout(resolve, 250));
}

export async function generateGroqJson(prompt: string, maxTokens: number): Promise<string | undefined> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('GROQ_API_KEY_MISSING');
  const model = getGroqModel();
  const isGptOssModel = /^openai\/gpt-oss-(?:20b|120b)$/.test(model);
  let lastError: unknown;

  for (let attempt = 0; attempt < GROQ_MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Return exactly one syntactically valid json object. Do not use Markdown fences or add text outside the json object. Follow the requested property names and value types.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          ...(isGptOssModel ? { reasoning_effort: 'low' } : {}),
          max_completion_tokens: maxTokens
        }),
        signal: AbortSignal.timeout(GROQ_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      lastError = error;
      const isTransient = error instanceof TypeError || (error instanceof Error && /timeout|abort/i.test(error.name + ' ' + error.message));
      if (isTransient && attempt + 1 < GROQ_MAX_ATTEMPTS) {
        await retryDelay();
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      lastError = providerError(response.status, await response.text());
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt + 1 < GROQ_MAX_ATTEMPTS) {
        await retryDelay();
        continue;
      }
      throw lastError;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return data.choices?.[0]?.message?.content ?? undefined;
  }

  throw lastError ?? new Error('Groq API request failed.');
}
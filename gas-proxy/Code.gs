/**
 * 『山月記』二学期末試験対策アプリ 手書き漢字判定プロキシ（GAS Web App）
 * 1. Google Apps Script を新規作成し、このコードを貼り付ける
 * 2. 「プロジェクトの設定」→「スクリプト プロパティ」に GEMINI_API_KEY を登録する
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 次のユーザーとして実行：自分
 *    - アクセスできるユーザー：全員
 * 4. 発行されたウェブアプリ URL を index.html の AI_PROXY_ENDPOINT に設定する
 */

const ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash"
];

function doPost(e) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY is not configured" });
    }

    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ error: "Empty request body" });
    }

    const body = JSON.parse(e.postData.contents);
    const imageBase64 = String(body.imageBase64 || "");
    const mimeType = body.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const expected = String(body.expected || "").trim().slice(0, 12);
    const model = ALLOWED_MODELS.includes(body.model) ? body.model : "gemini-2.5-flash";

    // サイズ・入力バリデーション（悪用・過大ペイロード防止）
    if (!imageBase64 || imageBase64.length > 400000 || !expected) {
      return jsonResponse({ error: "Invalid payload" });
    }

    // 汎用AIプロキシとして悪用されないよう、プロンプトはGAS側で漢字判定専用に固定生成する
    const fixedPrompt = [
      "手書き漢字の正誤判定をしてください。正解は「" + expected + "」です。",
      "スマホの指書きのため線が歪みやすい点に配慮し、細かなとめ・はね・はらいではなく、",
      "漢字の骨格・パーツ・送り仮名が正しく書けていてその字として読めるかで寛容に正解判定してください。",
      "必ず次のJSON形式のみを返してください：{\"recognized\":\"読み取った文字\",\"isCorrect\":trueまたはfalse,\"feedback\":\"25字以内の簡潔な一言\"}"
    ].join("\n");

    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);

    const payload = {
      contents: [
        {
          parts: [
            { text: fixedPrompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 150,
        responseMimeType: "application/json"
      }
    };

    const res = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      return jsonResponse({ error: "Gemini API error: " + res.getResponseCode() });
    }

    const apiData = JSON.parse(res.getContentText());
    const text = apiData &&
      apiData.candidates &&
      apiData.candidates[0] &&
      apiData.candidates[0].content &&
      apiData.candidates[0].content.parts &&
      apiData.candidates[0].content.parts[0] &&
      apiData.candidates[0].content.parts[0].text;

    if (!text) {
      return jsonResponse({ error: "No text in Gemini response" });
    }

    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const result = JSON.parse(cleaned);

    return jsonResponse({
      recognized: String(result.recognized || ""),
      isCorrect: Boolean(result.isCorrect),
      feedback: String(result.feedback || "").slice(0, 40)
    });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message ? err.message : err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

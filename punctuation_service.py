#!/usr/bin/env python3
"""
獨立的中文標點還原服務
使用 p208p2002/zh-wiki-punctuation-restore 模型
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoModelForTokenClassification, AutoTokenizer
import torch

app = FastAPI(title="Chinese Punctuation Service")

# 全域變數
model = None
tokenizer = None
model_name = "p208p2002/zh-wiki-punctuation-restore"

class TextRequest(BaseModel):
    text: str
    lang: str | None = None

def load_model():
    """載入模型"""
    global model, tokenizer
    print(f"Loading model: {model_name}...")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForTokenClassification.from_pretrained(model_name)
    model.eval()
    print("Model loaded successfully!")

def predict_punctuation(text: str) -> str:
    """預測標點 - 修復版"""
    if model is None or tokenizer is None:
        raise RuntimeError("Model not loaded")
    
    # 使用 return_offsets_mapping 取得 token 對文字的映射
    inputs = tokenizer(text, return_tensors='pt', padding=True, truncation=True, max_length=512, return_offsets_mapping=True)
    offset_mapping = inputs.pop('offset_mapping')[0]
    
    with torch.no_grad():
        outputs = model(**inputs)
    
    predictions = torch.argmax(outputs.logits, dim=-1)
    pred_labels = [model.config.id2label[p.item()] for p in predictions[0]]
    
    punct_map = {
        'S-，': '，', 'S-,': '，',
        'S-。': '。', 'S-.': '。',
        'S-？': '？', 'S-?': '？',
        'S-！': '！', 'S-!': '！'
    }
    
    # 建立 token_idx -> char_pos 的映射
    # offset_mapping[i] = (start_char, end_char) 表示這個 token 對應文字的哪些字元
    token_to_char = []
    for i, (start, end) in enumerate(offset_mapping.tolist()):
        if start == end:
            # 特殊 token (CLS, SEP, PAD)
            token_to_char.append(-1)
        else:
            token_to_char.append(start)
    
    # 找出標點預測，並轉換為字元位置
    punct_char_positions = set()
    for i, label in enumerate(pred_labels):
        if label in punct_map and i < len(token_to_char):
            char_pos = token_to_char[i]
            if char_pos >= 0:
                punct_char_positions.add(char_pos)
    
    # 根據字元位置重建文字
    result = []
    last_label = None
    for i, char in enumerate(text):
        result.append(char)
        if i in punct_char_positions:
            # 找到這個位置對應的 label
            for tok_idx, (start, end) in enumerate(offset_mapping.tolist()):
                if start <= i < end:
                    if tok_idx < len(pred_labels):
                        lbl = pred_labels[tok_idx]
                        if lbl in punct_map:
                            result.append(punct_map[lbl])
                            last_label = lbl
                    break
    
    final = ''.join(result)
    
    # 確保結尾有標點
    if not final.endswith(('。', '？', '！', '，')):
        final += '。'
    
    print(f"DEBUG: pred_labels={pred_labels[:15]}...")
    print(f"DEBUG: offset_mapping={offset_mapping[:10].tolist()}")
    print(f"DEBUG: punct_char_positions={punct_char_positions}")
    print(f"DEBUG: result={final}")
    return final

@app.on_event("startup")
async def startup_event():
    """啟動時載入模型"""
    load_model()

@app.get("/health")
async def health():
    """健康檢查"""
    return {"status": "ok", "model": model_name}

@app.post("/punct")
async def punct(request: TextRequest):
    """標點還原 API"""
    try:
        # 簡單語言偵測
        text = request.text
        if request.lang == "zh" or is_chinese(text):
            result = predict_punctuation(text)
        else:
            # 非中文只用簡單標點
            result = simple_punctuate(text)
        
        return {
            "original": text,
            "result": result,
            "lang": detect_lang(text)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def is_chinese(text: str) -> bool:
    """判斷是否為中文"""
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    return chinese_chars / len(text) > 0.3 if text else False

def detect_lang(text: str) -> str:
    """偵測語言"""
    return "zh" if is_chinese(text) else "en"

def simple_punctuate(text: str) -> str:
    """簡單標點（英文）"""
    text = text.strip()
    if not text:
        return text
    # 簡單句首大寫 + 句尾標點
    text = text[0].upper() + text[1:] if len(text) > 1 else text.upper()
    if not text[-1] in '.!?':
        text += '.'
    return text

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)

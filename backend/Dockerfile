# 基础镜像（Python 3.11 slim，避免重型 CUDA 依赖）
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先装依赖（利用层缓存）
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# 应用代码
COPY app ./app

# 私有数据挂载点（语料/索引/上传），镜像内不包含任何资料
RUN mkdir -p /mnt/rag-data /mnt/indexes /app/uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

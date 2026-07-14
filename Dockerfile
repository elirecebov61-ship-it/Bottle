FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render PORT env dəyişənini avtomatik verir, bot.py onu oxuyur
CMD ["python", "bot.py"]

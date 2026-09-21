import asyncio
from app.infrastructure.ai import fundamental_service as fs

async def main():
    print('HAS_OPENROUTER', fs.HAS_OPENROUTER)
    print('OPENROUTER_MODEL', fs.OPENROUTER_MODEL)
    prompt = 'Return valid JSON only: {"recommendation":"BUY","confidence":90,"bias":"test"}'
    try:
        result = await fs._call_openrouter(prompt)
        print('SUCCESS', result)
    except Exception as exc:
        print('ERROR', type(exc).__name__, exc)

asyncio.run(main())

.PHONY: install dev test seed demo clean

install:
	cd backend && pip install -e ".[dev]"
	cd frontend && npm install

dev:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
	cd frontend && npm run dev &
	@echo "Backend: http://localhost:8000"
	@echo "Frontend: http://localhost:5173"
	@echo "API docs: http://localhost:8000/docs"

test:
	cd backend && python -m pytest app/tests/ -v --tb=short

seed:
	cd backend && python -m app.seed.seed_data

demo:
	cd backend && python run_demo.py

clean:
	rm -rf backend/data/ frontend/node_modules frontend/dist
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true

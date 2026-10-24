from collections import defaultdict
from fastapi import FastAPI
from pydantic import BaseModel
app = FastAPI()

class Payload(BaseModel):
    sales: list[dict]     # {product_id, d, qty}
    products: list[dict]  # {id, name, stock, min_stock}

@app.post("/reorder")
def reorder(p: Payload, horizon_days: int = 14):
    """Daily demand blends the 60-day average (40%) with the last 14 days (60%) to catch back-to-school spikes."""
    total, recent = defaultdict(float), defaultdict(float)
    days = sorted({s["d"] for s in p.sales})
    cutoff = set(days[-14:])
    for s in p.sales:
        total[s["product_id"]] += s["qty"]
        if s["d"] in cutoff: recent[s["product_id"]] += s["qty"]
    out = []
    for pr in p.products:
        daily = 0.4 * total[pr["id"]] / 60 + 0.6 * recent[pr["id"]] / 14
        need = daily * horizon_days
        if pr["stock"] < max(need, pr["min_stock"]):
            out.append({"id": pr["id"], "name": pr["name"], "stock": pr["stock"],
                        "daily_demand": round(daily, 2),
                        "suggested_order": max(1, round(need + pr["min_stock"] - pr["stock"])),
                        "days_left": round(pr["stock"] / daily, 1) if daily else None})
    return sorted(out, key=lambda x: (x["days_left"] is None, x["days_left"] or 0))

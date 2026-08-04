"""Shared list filtering, stats, and CSV export for transaction ledger APIs."""
from __future__ import annotations

import csv
import io
from datetime import datetime, time
from decimal import Decimal
from typing import Iterable, Sequence

from django.db.models import Count, Q, QuerySet, Sum
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date


def parse_date_start(value: str | None) -> datetime | None:
    if not value:
        return None
    d = parse_date(value)
    if not d:
        return None
    return timezone.make_aware(datetime.combine(d, time.min))


def parse_date_end(value: str | None) -> datetime | None:
    if not value:
        return None
    d = parse_date(value)
    if not d:
        return None
    return timezone.make_aware(datetime.combine(d, time.max))


def apply_date_filters(qs: QuerySet, date_from: str | None, date_to: str | None) -> QuerySet:
    start = parse_date_start(date_from)
    end = parse_date_end(date_to)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lte=end)
    return qs


def apply_search(qs: QuerySet, search: str | None, fields: Sequence[str]) -> QuerySet:
    term = (search or "").strip()
    if not term:
        return qs
    q = Q()
    for field in fields:
        q |= Q(**{f"{field}__icontains": term})
    return qs.filter(q)


def txn_stats(qs: QuerySet, amount_field: str = "amount") -> dict:
    total_count = qs.count()
    by_status = qs.values("status").annotate(
        count=Count("id"),
        amount_sum=Sum(amount_field),
    )
    counts = {"pending": 0, "success": 0, "failed": 0}
    amounts = {
        "pending": Decimal("0"),
        "success": Decimal("0"),
        "failed": Decimal("0"),
    }
    for row in by_status:
        st = row["status"]
        if st in counts:
            counts[st] = row["count"]
            amounts[st] = row["amount_sum"] or Decimal("0")

    total_amount = amounts["pending"] + amounts["success"] + amounts["failed"]
    return {
        "total_count": total_count,
        "pending_count": counts["pending"],
        "success_count": counts["success"],
        "failed_count": counts["failed"],
        "total_amount": str(total_amount),
        "success_amount": str(amounts["success"]),
        "pending_amount": str(amounts["pending"]),
        "failed_amount": str(amounts["failed"]),
    }


def deposit_stats(qs: QuerySet) -> dict:
    total_count = qs.count()
    by_status = qs.values("status").annotate(
        count=Count("id"),
        amount_sum=Sum("amount"),
    )
    counts = {"pending": 0, "approved": 0, "rejected": 0}
    amounts = {
        "pending": Decimal("0"),
        "approved": Decimal("0"),
        "rejected": Decimal("0"),
    }
    for row in by_status:
        st = row["status"]
        if st in counts:
            counts[st] = row["count"]
            amounts[st] = row["amount_sum"] or Decimal("0")

    total_amount = amounts["pending"] + amounts["approved"] + amounts["rejected"]
    return {
        "total_count": total_count,
        "pending_count": counts["pending"],
        "success_count": counts["approved"],
        "failed_count": counts["rejected"],
        "total_amount": str(total_amount),
        "success_amount": str(amounts["approved"]),
        "pending_amount": str(amounts["pending"]),
        "failed_amount": str(amounts["rejected"]),
    }


def merge_stats(parts: list[dict]) -> dict:
    merged = {
        "total_count": 0,
        "pending_count": 0,
        "success_count": 0,
        "failed_count": 0,
        "total_amount": Decimal("0"),
        "success_amount": Decimal("0"),
        "pending_amount": Decimal("0"),
        "failed_amount": Decimal("0"),
    }
    for part in parts:
        merged["total_count"] += part.get("total_count", 0)
        merged["pending_count"] += part.get("pending_count", 0)
        merged["success_count"] += part.get("success_count", 0)
        merged["failed_count"] += part.get("failed_count", 0)
        merged["total_amount"] += Decimal(part.get("total_amount", "0"))
        merged["success_amount"] += Decimal(part.get("success_amount", "0"))
        merged["pending_amount"] += Decimal(part.get("pending_amount", "0"))
        merged["failed_amount"] += Decimal(part.get("failed_amount", "0"))

    return {
        "total_count": merged["total_count"],
        "pending_count": merged["pending_count"],
        "success_count": merged["success_count"],
        "failed_count": merged["failed_count"],
        "total_amount": str(merged["total_amount"]),
        "success_amount": str(merged["success_amount"]),
        "pending_amount": str(merged["pending_amount"]),
        "failed_amount": str(merged["failed_amount"]),
    }


def csv_response(filename: str, rows: Iterable[dict], fieldnames: Sequence[str]) -> HttpResponse:
    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    response = HttpResponse(buffer.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def list_params(request) -> dict:
    return {
        "date_from": request.query_params.get("date_from"),
        "date_to": request.query_params.get("date_to"),
        "search": request.query_params.get("search"),
        "status": (request.query_params.get("status") or "").strip().lower(),
        "format": (request.query_params.get("format") or "").strip().lower(),
    }

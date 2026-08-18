"""Semantic search service stub."""


class _SemanticSearchService:
    async def search(self, query: str, limit: int = 10):
        return []


semantic_search_service = _SemanticSearchService()

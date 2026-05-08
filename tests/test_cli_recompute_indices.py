"""Smoke-test the `xcs-gen recompute-indices` CLI dispatch."""
from __future__ import annotations

from unittest.mock import patch

from xcs_gen.cli import main


def test_cli_dispatches_to_recompute_indices() -> None:
    """Calling the CLI with `recompute-indices` invokes the repo
    function with the parsed arguments."""
    with patch(
        "xcs_gen_web.repositories.palette.recompute_indices",
        return_value=3,
    ) as mock_fn:
        main(["recompute-indices"])
        mock_fn.assert_called_once()
        kwargs = mock_fn.call_args.kwargs
        assert kwargs.get("material_id") is None
        assert kwargs.get("force") is False


def test_cli_passes_material_id_and_force() -> None:
    with patch(
        "xcs_gen_web.repositories.palette.recompute_indices",
        return_value=0,
    ) as mock_fn:
        main(["recompute-indices", "--material-id", "7", "--force"])
        kwargs = mock_fn.call_args.kwargs
        assert kwargs["material_id"] == 7
        assert kwargs["force"] is True

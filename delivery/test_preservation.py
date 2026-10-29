import copy
import unittest

from preservation import compare_snapshots


class PreservationTest(unittest.TestCase):
    def setUp(self):
        self.before = {
            "requests": [{"id": "legacy", "owner_id": None, "assignee_id": "staff"},
                         {"id": "owned", "owner_id": "account", "assignee_id": None}],
            "history": [{"id": 10, "old_value": "NEW", "new_value": "IN_PROGRESS",
                         "actor_username": "original-name"}],
        }
        self.after = copy.deepcopy(self.before)

    def test_owned_and_ownerless_records_pass_independent_of_row_order(self):
        self.after["requests"].reverse()
        compare_snapshots(self.before, self.after)

    def test_changed_ownership_fails_including_null_transitions(self):
        for index, owner in [(0, "account"), (1, None), (1, "different-account")]:
            with self.subTest(index=index, owner=owner):
                after = copy.deepcopy(self.before)
                after["requests"][index]["owner_id"] = owner
                with self.assertRaisesRegex(ValueError, "owner_id"):
                    compare_snapshots(self.before, after)

    def test_missing_record_fails(self):
        self.after["requests"].pop()
        with self.assertRaisesRegex(ValueError, "missing IDs"):
            compare_snapshots(self.before, self.after)

    def test_changed_history_values_and_actor_fail(self):
        for field in ["old_value", "new_value", "actor_username"]:
            with self.subTest(field=field):
                after = copy.deepcopy(self.before)
                after["history"][0][field] = "changed"
                with self.assertRaisesRegex(ValueError, field):
                    compare_snapshots(self.before, after)

    def test_unexpected_records_are_not_excluded(self):
        self.after["requests"].append({"id": "unexpected", "owner_id": "account"})
        with self.assertRaisesRegex(ValueError, "added IDs"):
            compare_snapshots(self.before, self.after)

    def test_duplicate_identity_fails(self):
        self.after["requests"].append(self.after["requests"][0])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            compare_snapshots(self.before, self.after)

    def test_removed_field_is_not_equal_to_null(self):
        del self.after["requests"][0]["owner_id"]
        with self.assertRaisesRegex(ValueError, "owner_id"):
            compare_snapshots(self.before, self.after)


if __name__ == "__main__":
    unittest.main()

/** Delete response fixture. */
export const deleteResponseFixture = {
	deleted: true,
	id: 42,
};

/** Error response fixture with string message. */
export const errorResponseFixture = {
	error: {
		message: "The contact has not been found.",
		error_code: 31,
	},
};

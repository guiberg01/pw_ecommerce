export const useSoftDelete = (schema) => {
  schema.add({
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  });

  const applySoftDeleteFilter = function (next) {
    const filter = typeof this.getFilter === "function" ? this.getFilter() : this.getQuery();

    if (filter?.includeDeleted) {
      delete filter.includeDeleted;
      this.setQuery(filter);
      return next();
    }

    if (!Object.prototype.hasOwnProperty.call(filter, "deletedAt")) {
      this.where({ deletedAt: null });
    }

    next();
  };

  schema.pre("find", applySoftDeleteFilter);
  schema.pre("findOne", applySoftDeleteFilter);
  schema.pre("findOneAndUpdate", applySoftDeleteFilter);
  schema.pre("count", applySoftDeleteFilter);
  schema.pre("countDocuments", applySoftDeleteFilter);

  schema.pre("aggregate", function (next) {
    const pipeline = this.pipeline();

    if (pipeline[0]?.$match?.includeDeleted) {
      delete pipeline[0].$match.includeDeleted;
      return next();
    }

    pipeline.unshift({ $match: { deletedAt: null } });
    next();
  });
};

export function retrieveCreators(items, creators, itemId) {
  const itemCreators = [];

  items.forEach((item) => {
    const creatorIds = item.creator?.map(({ id }) => id);
    if (creatorIds == null) return;

    creatorIds.forEach((creatorId) => {
      if (
        creatorId == itemId ||
        itemCreators.find(({ id }) => creatorId === id) ||
        items.find(({ id }) => creatorId === id)
      )
        return;

      itemCreators.push(creators.find(({ id }) => creatorId === id));
    });
  });

  return itemCreators;
}

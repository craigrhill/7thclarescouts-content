// Default site content, used until leaders save content in admin.html
window.DEFAULT_CONTENT = {
  settings: {
    heroTitle: "Adventure, friendship and the outdoors, on the edge of the Burren.",
    heroLede: "7th Clare Scout Group in Ballyvaughan welcomes young people from 6 to 17. We camp, hike, build, cook, paddle and learn to look after each other and the wild places around us.",
    about: "We're a volunteer-run Scout Group based in Ballyvaughan, County Clare, part of Scouting Ireland. Our programme is built around the Burren: limestone hills, the Atlantic on our doorstep, caves, green roads and dark skies.\n\nYoung people plan their own adventures with the support of trained adult leaders, gaining skills, confidence and a lasting love of the outdoors along the way.",
    venue: "Beavers and Cubs meet at the hall in Ballyvaughan. Scouts and Ventures meet at Newquay National School.",
    email: "7thclarescouts@gmail.com",
    phone: "",
    social: [
      { name:"facebook", url:"" }
    ],
    venues: [
      { name:"The Hall, Ballyvaughan", query:"Ballyvaughan Hall, Ballyvaughan, Co. Clare", link:"https://maps.app.goo.gl/EUeUCyrZT5u3BVAE6" },
      { name:"Newquay National School", query:"Newquay National School, New Quay, Co. Clare", link:"https://maps.app.goo.gl/f47QxW9KYiKD9x3DA" }
    ],
    team: [
      { name:"[PLACEHOLDER] Name", role:"Group Leader", section:"" },
      { name:"[PLACEHOLDER] Name", role:"Deputy Group Leader", section:"" },
      { name:"[PLACEHOLDER] Name", role:"Chair", section:"" },
      { name:"[PLACEHOLDER] Name", role:"Section Leader", section:"beavers" },
      { name:"[PLACEHOLDER] Name", role:"Section Leader", section:"cubs" },
      { name:"[PLACEHOLDER] Name", role:"Section Leader", section:"scouts" },
      { name:"[PLACEHOLDER] Name", role:"Section Leader", section:"ventures" }
    ],
    sections: [
      { key:"beavers", name:"Beavers", ages:"Ages 6 to 8", day:"Tuesday", time:"6:00 to 7:00 pm", venue:"The Hall, Ballyvaughan", blurb:"Games, crafts, nature and first adventures. Beavers learn by playing and exploring together." },
      { key:"cubs", name:"Cubs", ages:"Ages 9 to 11", day:"Thursday", time:"6:30 to 8:00 pm", venue:"The Hall, Ballyvaughan", blurb:"Badges, hikes, campfires and first nights away under canvas." },
      { key:"scouts", name:"Scouts", ages:"Ages 12 to 15", day:"Thursday", time:"6:00 to 7:30 pm", venue:"Newquay National School", blurb:"Patrol-led camping, pioneering, navigation and expeditions across Clare and beyond." },
      { key:"ventures", name:"Ventures", ages:"Ages 15 to 17", day:"Thursday", time:"6:00 to 7:30 pm", venue:"Newquay National School", blurb:"Youth-led challenges, mountain trips, international events and leadership." }
    ]
  },
  badges: {
    imageUrl: "photos/uniform-badge-placement.jpg",
    imageCaption: "On the full uniform shirt",
    intro: "Every young person works through the same nine Adventure Skills, from stage 1 to stage 9, whichever section they are in. You start at stage 1 no matter your age, keep the highest stage badge you have earned on your sleeve, and replace it when you move up. Most Scouts settle on two or three skills they really enjoy rather than trying all nine.",
    stages: "As a rough guide, Beavers usually reach stages 1 to 2, Cubs stages 2 to 4, Scouts stages 3 to 6 and Ventures stages 5 to 9, but the stages are not tied to sections and a keen Cub can be ahead of a new Scout.",
    placement: [
      { area: "Right chest (as you wear it)", items: ["World Scout badge (purple circle)"] },
      { area: "Left chest", items: ["Scouting Ireland membership badge (navy circle)"] },
      { area: "Left sleeve, top to bottom", items: ["7th Clare group badge", "Clare County badge", "Section badge (Beaver, Cub, Scout, Venture)"] },
      { area: "Right sleeve, top to bottom", items: ["Adventure Skills stage badges (highest stage only, one per skill)", "Special Interest badges below them"] },
      { area: "Progress badges", items: ["[PLACEHOLDER] Confirm with your section leader where the section's progress badges (Bree, Ruarc, Conn for Beavers; Turas, Taisteal, Tagann for Cubs) are worn"] }
    ],
    note: "This is the layout our leaders use. If a badge doesn't fit, ask before sewing: moving a badge leaves holes. Jumpers and uniform shirts follow the same layout."
  },
  fundraising: {
    intro: "Everything we do is run by volunteers, and every euro raised goes straight back into the young people: tents, stoves, camp fees and keeping subs as low as we can.",
    donateTitle: "Support 7th Clare",
    donateText: "[PLACEHOLDER] A one-off donation of any size makes a real difference. Donations go to the group account and are used only for equipment and activities.",
    donateUrl: "",
    donateLabel: "Donate",
    campaigns: [
      { title:"[PLACEHOLDER] New patrol tents", blurb:"Replacing our oldest patrol tents before the summer camp season.", goal:2000, raised:450, link:"", linkLabel:"" }
    ],
    help: "Bag-packing days, the annual quiz night and the Christmas raffle all need helpers and prizes. If you can give a few hours, donate a prize, or know a business that might sponsor a tent, email the group.\n\nIf you shop online, ask us about fundraising schemes that give a percentage back to the group at no cost to you.",
    sponsors: []
  },
  notices: [
    { title:"Welcome back for the new Scouting year", body:"Meetings resume this month. Check your section's night below and keep an eye here for changes." }
  ],
  // No sample events. A seeded event looks exactly like a real one to
  // every part of the app, and six of them sat on the live calendar for
  // months beside the same events arriving properly from the county: the
  // county inbox matches on countyId, which a seeded event has not, so it
  // could neither recognise them nor tidy them away. Leaders add their own.
  events: [
  ],
  news: [
    { date:"2026-09-01", title:"New website launched", body:"Our new home online. Events, notices and news will appear here through the year." }
  ],
  // Photos are added by leaders in admin. A photo with a section key shows on
  // that section's page as well as in the gallery; without one it is
  // group-wide and shows in the gallery only.
  gallery: []
};
